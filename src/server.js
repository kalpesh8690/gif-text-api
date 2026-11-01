import express from "express";
import multer from "multer";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { overlayTextOnGif } from "./gif.service.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 15728640);
const MAX_CONCURRENT_JOBS = Number(process.env.MAX_CONCURRENT_JOBS || 2);

let activeJobs = 0;

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "10kb" }));

const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 900000),
  limit: Number(process.env.RATE_LIMIT_MAX || 20),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again later."
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: 10,
    fieldSize: 4096
  },
  fileFilter: (req, file, callback) => {
    if (file.mimetype !== "image/gif") {
      return callback(new Error("Upload a GIF using the template field"));
    }
    callback(null, true);
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    service: "GIF Text Overlay API",
    status: "running",
    font: "Mulish",
    activeJobs,
    maxConcurrentJobs: MAX_CONCURRENT_JOBS
  });
});

app.post(
  "/api/gif/overlay",
  limiter,
  upload.single("template"),
  async (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "GIF template file is required in form-data field 'template'"
      });
    }

    if (activeJobs >= MAX_CONCURRENT_JOBS) {
      return res.status(503).json({
        success: false,
        message: "GIF generator is busy. Please retry shortly."
      });
    }

    activeJobs += 1;

    try {
      const text = req.body.text;
      const x = Number(req.body.x);
      const y = Number(req.body.y);
      const fontSize = req.body.fontSize === undefined
        ? 48
        : Number(req.body.fontSize);
      const lineHeight = req.body.lineHeight === undefined
        ? 1.25
        : Number(req.body.lineHeight);

      const result = await overlayTextOnGif(req.file.buffer, {
        text,
        x,
        y,
        fontSize,
        color: req.body.color || "#FFFFFF",
        align: req.body.align || "center",
        lineHeight
      });

      res.set({
        "Content-Type": "image/gif",
        "Content-Length": String(result.size),
        "Content-Disposition": 'attachment; filename="' + result.filename + '"',
        "Cache-Control": "no-store"
      });

      return res.status(200).send(result.buffer);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message || "GIF generation failed"
      });
    } finally {
      activeJobs -= 1;
    }
  }
);

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  const status = error instanceof multer.MulterError
    ? (error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
    : 400;

  res.status(status).json({
    success: false,
    message: error.message || "Request failed"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("GIF Text Overlay API listening on port " + PORT);
});

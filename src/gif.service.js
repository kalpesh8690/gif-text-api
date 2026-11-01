import sharp from "sharp";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobePath from "ffprobe-static";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createTextOverlay } from "./text-overlay.js";

const MAX_DIMENSION = 1500;
const MAX_FRAMES = 500;
const MAX_DURATION_SECONDS = 30;
const MAX_OUTPUT_BYTES = Number(process.env.MAX_OUTPUT_BYTES || 26214400);

function runProcess(binary, args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    if (!binary) {
      reject(new Error("Required media processing binary is unavailable"));
      return;
    }

    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
      if (stdout.length > 2_000_000) {
        child.kill("SIGKILL");
      }
    });

    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });

    child.on("error", error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", code => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(
          code === null
            ? "Media processing timed out"
            : "Media processing failed: " + stderr.slice(-1800)
        ));
      }
    });
  });
}

async function inspectGif(inputPath) {
  const metadata = await sharp(inputPath, { animated: true }).metadata();

  if (metadata.format !== "gif") {
    throw new Error("Uploaded file is not a valid GIF");
  }

  const probe = await runProcess(ffprobePath, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,nb_frames:format=duration",
    "-of", "json",
    inputPath
  ], 15000);

  const info = JSON.parse(probe.stdout);
  const stream = info.streams && info.streams[0];

  if (!stream) throw new Error("Could not read GIF video stream");

  const width = Number(stream.width);
  const height = Number(stream.height);
  const frameCount = Number(stream.nb_frames);
  const duration = Number(info.format && info.format.duration);

  if (
    !Number.isInteger(width) || !Number.isInteger(height) ||
    width < 1 || height < 1 ||
    width > MAX_DIMENSION || height > MAX_DIMENSION
  ) {
    throw new Error("GIF dimensions must not exceed 1500x1500");
  }

  if (Number.isFinite(frameCount) && frameCount > MAX_FRAMES) {
    throw new Error("GIF cannot contain more than " + MAX_FRAMES + " frames");
  }

  if (Number.isFinite(duration) && duration > MAX_DURATION_SECONDS) {
    throw new Error("GIF duration cannot exceed " + MAX_DURATION_SECONDS + " seconds");
  }

  return { width, height, frameCount, duration };
}

export async function overlayTextOnGif(gifBuffer, options) {
  const signature = gifBuffer.subarray(0, 6).toString("ascii");

  if (signature !== "GIF87a" && signature !== "GIF89a") {
    throw new Error("Uploaded file must be a GIF");
  }

  const id = crypto.randomUUID();
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "gif-text-" ));

  const inputPath = path.join(workDir, "template.gif");
  const overlayPath = path.join(workDir, "text-overlay.png");
  const outputPath = path.join(workDir, "result.gif");

  try {
    await fs.writeFile(inputPath, gifBuffer);

    const dimensions = await inspectGif(inputPath);

    const overlayBuffer = await createTextOverlay({
      ...options,
      width: dimensions.width,
      height: dimensions.height
    });

    await fs.writeFile(overlayPath, overlayBuffer);

    const filter = [
      "[0:v][1:v]overlay=0:0:format=auto:shortest=0:eof_action=repeat:repeatlast=1",
      "split[base][paletteSource]",
      "[paletteSource]palettegen=reserve_transparent=1:stats_mode=full[palette]",
      "[base][palette]paletteuse=dither=sierra2_4a[out]"
    ].join(";");

    await runProcess(ffmpegPath, [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-i", inputPath,
      "-i", overlayPath,
      "-filter_complex", filter,
      "-map", "[out]",
      "-fps_mode", "passthrough",
      "-loop", "0",
      "-map_metadata", "0",
      outputPath
    ], 60000);

    const stat = await fs.stat(outputPath);

    if (!stat.size || stat.size > MAX_OUTPUT_BYTES) {
      throw new Error("Generated GIF is empty or exceeds the output size limit");
    }

    const outputBuffer = await fs.readFile(outputPath);

    return {
      buffer: outputBuffer,
      filename: id + ".gif",
      width: dimensions.width,
      height: dimensions.height,
      size: outputBuffer.length,
      originalFrameCount: dimensions.frameCount
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

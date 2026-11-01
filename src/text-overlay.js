import sharp from "sharp";
import fontkit from "fontkit";
import { fileURLToPath } from "node:url";

const MULISH_FONT_PATH = fileURLToPath(
  new URL("../node_modules/@fontsource/mulish/files/mulish-latin-700-normal.woff2", import.meta.url)
);

const mulishFont = fontkit.openSync(MULISH_FONT_PATH);

function assertIntegerInRange(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(label + " must be an integer between " + min + " and " + max);
  }
}

export async function createTextOverlay(options) {
  const {
    text,
    width,
    height,
    x,
    y,
    fontSize = 48,
    color = "#FFFFFF",
    align = "center",
    lineHeight = 1.25
  } = options;

  if (typeof text !== "string" || !text.trim() || text.length > 200) {
    throw new Error("Text must contain 1-200 characters");
  }

  assertIntegerInRange(width, 1, 1500, "Width");
  assertIntegerInRange(height, 1, 1500, "Height");
  assertIntegerInRange(x, 0, width - 1, "X coordinate");
  assertIntegerInRange(y, 1, height, "Y coordinate");
  assertIntegerInRange(fontSize, 8, 160, "Font size");

  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new Error("Color must be a six-digit hex value, e.g. #FFFFFF");
  }

  if (!["left", "center", "right"].includes(align)) {
    throw new Error("Alignment must be left, center, or right");
  }

  if (typeof lineHeight !== "number" || lineHeight < 1 || lineHeight > 2) {
    throw new Error("Line height must be between 1 and 2");
  }

  const scale = fontSize / mulishFont.unitsPerEm;
  const lines = text.replace(/\r/g, "").split("\n");
  const lineAdvance = Math.round(fontSize * lineHeight);
  const paths = [];

  lines.forEach((line, lineIndex) => {
    const run = mulishFont.layout(line);
    let cursorX = x;

    if (align === "center") {
      cursorX -= (run.advanceWidth * scale) / 2;
    } else if (align === "right") {
      cursorX -= run.advanceWidth * scale;
    }

    const baselineY = y + lineIndex * lineAdvance;

    run.glyphs.forEach((glyph, index) => {
      const position = run.positions[index];
      const glyphPath = glyph.path.toSVG();

      if (glyphPath) {
        const glyphX = cursorX + position.xOffset * scale;
        const glyphY = baselineY - position.yOffset * scale;

        paths.push(
          '<path d="' + glyphPath + '" transform="translate(' +
          glyphX.toFixed(3) + ' ' + glyphY.toFixed(3) +
          ') scale(' + scale.toFixed(6) + ' ' + (-scale).toFixed(6) + ')" />'
        );
      }

      cursorX += position.xAdvance * scale;
    });
  });

  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">',
    '<g fill="' + color + '">',
    paths.join(""),
    "</g>",
    "</svg>"
  ].join("");

  return sharp(Buffer.from(svg))
    .png()
    .toBuffer();
}

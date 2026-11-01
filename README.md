# GIF Text Overlay API

A Node.js REST API that adds static text to an existing animated GIF template. The text is rendered in the **Mulish Bold** font and composited over every animation frame at a custom X/Y position.

## Features

- Upload an existing GIF template.
- Add static text at custom X/Y coordinates.
- Mulish Bold font is bundled through the @fontsource/mulish package.
- Configure font size, color, alignment and line spacing.
- Retain the source GIF's dimensions and animation sequence.
- Re-encode using FFmpeg palette generation for GIF-compatible colors.
- Upload, output-size, dimension, frame-count, duration, rate and concurrency limits.
- No template files are permanently stored by the API.

## Requirements

- Node.js 20 or newer
- npm
- FFmpeg and FFprobe binaries supplied by the ffmpeg-static and ffprobe-static packages

## Install and run

```bash
npm install
cp .env.example .env
npm run dev
```

The API listens on http://localhost:3000 by default.

## Health check

```http
GET /api/health
```

## Overlay text

```http
POST /api/gif/overlay
Content-Type: multipart/form-data
```

Send these form-data fields:

| Field | Type | Required | Default | Description |
|---|---|---:|---|---|
| template | File | Yes | — | Source animated GIF |
| text | Text | Yes | — | Text to draw; supports newline |
| x | Text | Yes | — | X coordinate in pixels |
| y | Text | Yes | — | Baseline Y coordinate in pixels |
| fontSize | Text | No | 48 | Mulish font size, 8-160 |
| color | Text | No | #FFFFFF | Six-digit hex color |
| align | Text | No | center | left, center or right |
| lineHeight | Text | No | 1.25 | Multiline spacing multiplier, 1-2 |

Coordinates are relative to the top-left corner of the GIF. For centered text, X is the horizontal center anchor. Y is the baseline of the first line.

### cURL example

```bash
curl -X POST http://localhost:3000/api/gif/overlay \
  -F "template=@template.gif" \
  -F "text=Happy Birthday!" \
  -F "x=300" \
  -F "y=150" \
  -F "fontSize=48" \
  -F "color=#FFFFFF" \
  -F "align=center" \
  --output result.gif
```

The successful response is a binary GIF with Content-Type image/gif.

## Limits

Defaults can be changed with environment variables:

| Variable | Default |
|---|---:|
| PORT | 3000 |
| MAX_CONCURRENT_JOBS | 2 |
| RATE_LIMIT_WINDOW_MS | 900000 |
| RATE_LIMIT_MAX | 20 |
| MAX_UPLOAD_BYTES | 15728640 (15 MiB) |
| MAX_OUTPUT_BYTES | 26214400 (25 MiB) |

The service currently accepts GIFs up to 1500x1500 pixels, 500 frames and 30 seconds.

## Docker

```bash
docker build -t gif-text-api .
docker run --rm -p 3000:3000 gif-text-api
```

## Animation and fidelity notes

FFmpeg decodes the GIF, composites the same transparent text layer over the animation, then re-encodes the result with a generated palette. The source template is not modified.

GIF is a palette-based format, so re-encoding can slightly change colors or dithering. The output is configured to loop indefinitely; the source GIF's original finite loop count is not preserved. Frame timing is passed through FFmpeg, but exact byte-for-byte preservation is not possible after re-encoding.

## Security

- File size and GIF signature validation.
- GIF dimensions, frame count and duration limits.
- Multer memory upload limits.
- Rate limiting and bounded concurrent processing.
- Temporary files are removed after each request.
- SVG text is rendered from font glyph paths; user text is not injected into SVG markup.
- Only six-digit hex text colors and fixed Mulish font assets are accepted.

For public production deployments, put the service behind HTTPS and authentication, and monitor memory/CPU usage.

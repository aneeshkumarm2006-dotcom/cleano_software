// Draw a signature from the strokes the finger made, into a PNG the server
// owns (packages/api/src/v1/documents.ts, DrawnSignature).
//
// Nothing the phone or browser sends is stored as an image: only numbers come
// in, and this turns them into black ink on white. Pure (node:zlib only), so a
// verify script can decode what it makes.
import { deflateSync } from "node:zlib";

export interface StrokeInput {
  width: number;
  height: number;
  strokes: readonly (readonly (readonly [number, number])[])[];
}

/** The stored image is at most this wide; a wider pad is scaled down. */
const MAX_OUT_WIDTH = 1000;

/**
 * The most ink, in output pixels, the renderer will draw. A real signature on
 * the widest pad is a few thousand; this only stops a request built to make
 * the server draw for seconds.
 */
export const MAX_RENDER_INK = 150_000;

export function renderScale(width: number): number {
  return Math.min(1, MAX_OUT_WIDTH / width);
}

/** The strokes' length once scaled to the output, in pixels. */
export function renderInk(input: StrokeInput): number {
  const s = renderScale(input.width);
  let ink = 0;
  for (const stroke of input.strokes) {
    for (let i = 1; i < stroke.length; i++) {
      ink += Math.hypot((stroke[i]![0] - stroke[i - 1]![0]) * s, (stroke[i]![1] - stroke[i - 1]![1]) * s);
    }
  }
  return ink;
}

/**
 * Render the strokes to an 8-bit greyscale PNG, black on white, anti-aliased.
 * The caller has already checked the points are inside the pad and the ink is
 * within MAX_RENDER_INK.
 */
export function renderSignaturePng(input: StrokeInput): Buffer {
  const s = renderScale(input.width);
  const w = Math.max(1, Math.round(input.width * s));
  const h = Math.max(1, Math.round(input.height * s));
  const px = new Uint8Array(w * h).fill(255);
  const r = Math.max(1.25, w / 300);

  const plot = (x0: number, y0: number, x1: number, y1: number) => {
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - r - 1));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(x0, x1) + r + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - r - 1));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(y0, y1) + r + 1));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    for (let y = minY; y <= maxY; y++) {
      const cy = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const cx = x + 0.5;
        let t = len2 === 0 ? 0 : ((cx - x0) * dx + (cy - y0) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(cx - (x0 + t * dx), cy - (y0 + t * dy));
        // Full ink inside the pen, a one-pixel soft edge outside it.
        const cover = d <= r - 0.5 ? 1 : d >= r + 0.5 ? 0 : r + 0.5 - d;
        if (cover > 0) {
          const v = Math.round(255 * (1 - cover));
          const k = y * w + x;
          if (v < px[k]!) px[k] = v;
        }
      }
    }
  };

  // Long segments are cut into short pieces, so each piece's box stays small.
  const STEP = 8;
  for (const stroke of input.strokes) {
    if (stroke.length === 1) {
      const [x, y] = stroke[0]!;
      plot(x * s, y * s, x * s, y * s);
      continue;
    }
    for (let i = 1; i < stroke.length; i++) {
      const ax = stroke[i - 1]![0] * s;
      const ay = stroke[i - 1]![1] * s;
      const bx = stroke[i]![0] * s;
      const by = stroke[i]![1] * s;
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / STEP));
      for (let k = 0; k < n; k++) {
        plot(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, ax + ((bx - ax) * (k + 1)) / n, ay + ((by - ay) * (k + 1)) / n);
      }
    }
  }

  return encodeGreyPng(px, w, h);
}

// ── PNG ─────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodeGreyPng(px: Uint8Array, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0; // filter: none
    raw.set(px.subarray(y * w, (y + 1) * w), y * (w + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

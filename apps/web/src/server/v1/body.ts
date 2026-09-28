// Reading a v1 request body under a byte cap (API_V1.md §4). Kept apart from
// route.ts, which pulls in auth and the database, so the rules script can
// test it with nothing running.
import { E, V1Error } from "./http";

export async function readJsonBody(req: Request, maxBytes: number): Promise<unknown> {
  // Refused on the declared length before a byte is read; the read itself is
  // counted again below for a body that lied about its length or sent none.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new V1Error(413, "BODY_TOO_LARGE", "That request is too large.");
  }
  const bytes = await readCappedBytes(req, maxBytes);
  if (bytes.byteLength === 0) return undefined;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw E.badRequest("That request wasn't valid JSON.");
  }
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw E.badRequest("That request wasn't valid JSON.");
  }
}

/**
 * The body as bytes, refused with 413 the moment it passes `maxBytes`.
 *
 * Counted in BYTES, not UTF-16 code units: `text.length` undercounts anything
 * outside ASCII (a 4-byte emoji is 2 units), so a body of multi-byte text
 * could carry up to 2x the cap. And counted while streaming, so an
 * over-sized body with no (or a false) Content-Length is cut off at the cap
 * instead of being buffered whole first.
 */
async function readCappedBytes(req: Request, maxBytes: number): Promise<Uint8Array> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new V1Error(413, "BODY_TOO_LARGE", "That request is too large.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

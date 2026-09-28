// API v1, the record area (documents, training): the pure rules. No database,
// no server.
//
//   npx tsx --conditions react-server scripts/verify-api-v1-record.ts
//
// Which stored URLs may go to a phone (company storage, training video
// hosts), the drawn-signature limits, and the server's own signature image.
import { inflateSync } from "node:zlib";

import { DrawnSignature, signatureInk } from "@bookmops/api/v1";

import { MAX_RENDER_INK, renderInk, renderSignaturePng } from "../src/server/documents/signature-png";
import { parseCompanyFileUrl, publicVideoUrl } from "../src/server/storage/company-file-url";

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

// ── Company storage ─────────────────────────────────────────────────────────
{
  const o = { cloudName: "ourcloud", orgSlug: "acme" };
  const base = "https://res.cloudinary.com/ourcloud";
  check(
    "storage: a PDF in the company's folder",
    parseCompanyFileUrl(`${base}/raw/upload/v1712345/awer/acme/docs/policy.pdf`, o),
    { resourceType: "raw", deliveryType: "upload", publicId: "awer/acme/docs/policy.pdf", format: null },
  );
  check(
    "storage: an authenticated video keeps its format apart",
    parseCompanyFileUrl(`${base}/video/authenticated/s--AbCdEf12--/v1/awer/acme/training/intro.mp4`, o),
    { resourceType: "video", deliveryType: "authenticated", publicId: "awer/acme/training/intro", format: "mp4" },
  );
  const refused: [string, string][] = [
    ["another company's folder", `${base}/raw/upload/awer/other/docs/p.pdf`],
    ["another cloud", "https://res.cloudinary.com/theircloud/raw/upload/awer/acme/p.pdf"],
    ["the folder root alone", `${base}/raw/upload/awer/acme`],
    ["a legacy shared folder", `${base}/raw/upload/cleano/docs/p.pdf`],
    ["a transformation", `${base}/image/upload/c_fill,w_100/awer/acme/p.png`],
    ["http", "http://res.cloudinary.com/ourcloud/raw/upload/awer/acme/p.pdf"],
    ["a look-alike host", "https://res.cloudinary.com.evil.test/ourcloud/raw/upload/awer/acme/p.pdf"],
    ["credentials", "https://u:p@res.cloudinary.com/ourcloud/raw/upload/awer/acme/p.pdf"],
    ["a query", `${base}/raw/upload/awer/acme/p.pdf?x=1`],
    ["a private asset", `${base}/raw/private/awer/acme/p.pdf`],
    ["dot segments", `${base}/raw/upload/awer/acme/%2e%2e/other/p.pdf`],
    ["Google Drive", "https://drive.google.com/file/d/abc/view"],
  ];
  for (const [what, url] of refused) check(`storage: refuses ${what}`, parseCompanyFileUrl(url, o), null);
  check("storage: nothing without a cloud name", parseCompanyFileUrl(`${base}/raw/upload/awer/acme/p.pdf`, { cloudName: undefined, orgSlug: "acme" }), null);
}

// ── Training video hosts ────────────────────────────────────────────────────
{
  const ok = [
    "https://www.youtube.com/watch?v=abc",
    "https://youtu.be/abc",
    "https://vimeo.com/123",
    "https://player.vimeo.com/video/123",
  ];
  for (const u of ok) check(`video: allows ${u}`, publicVideoUrl(u) !== null, true);
  const no = [
    "http://www.youtube.com/watch?v=abc",
    "https://youtube.com.evil.test/x",
    "https://evilyoutube.com/x",
    "https://user:pw@youtube.com/x",
    "https://youtube.com:8443/x",
    "javascript:alert(1)",
    "https://example.com/video.mp4",
    "https://res.cloudinary.com/ourcloud/video/upload/awer/acme/v.mp4",
  ];
  for (const u of no) check(`video: refuses ${u}`, publicVideoUrl(u), null);
}

// ── Drawn signatures ────────────────────────────────────────────────────────
const line = (x0: number, y0: number, x1: number, y1: number, n = 20) =>
  Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n] as [number, number]);
// Corner to corner and back: the most ink the fewest points can carry.
const zigzag = (n: number) => Array.from({ length: n }, (_, i) => [i % 2 ? 2000 : 0, i % 2 ? 1000 : 0] as [number, number]);
{
  const good = { width: 600, height: 200, strokes: [line(50, 100, 300, 120), line(300, 120, 400, 60)] };
  check("signature: a real one passes", DrawnSignature.safeParse(good).success, true);
  check("signature: a tap is not a signature", DrawnSignature.safeParse({ ...good, strokes: [[[10, 10]]] }).success, false);
  check("signature: under the minimum ink", signatureInk([line(10, 10, 30, 10)]) < 40, true);
  const many = Array.from({ length: 6 }, () => line(0, 0, 500, 150, 1999));
  check("signature: over 10,000 points", DrawnSignature.safeParse({ ...good, strokes: many }).success, false);
  check("signature: a point outside the largest pad", DrawnSignature.safeParse({ ...good, strokes: [[[50, 50], [2500, 50]]] }).success, false);
  check("signature: no markup, only numbers", DrawnSignature.safeParse({ ...good, strokes: [[["<svg>", 1]]] }).success, false);

  const png = renderSignaturePng(good);
  check("render: a PNG", png.subarray(1, 4).toString("ascii"), "PNG");
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  check("render: the pad's size", [w, h], [600, 200]);
  // Decode the single IDAT and count inked pixels.
  let off = 8;
  let idat = Buffer.alloc(0);
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.subarray(off + 4, off + 8).toString("ascii");
    if (type === "IDAT") idat = Buffer.concat([idat, png.subarray(off + 8, off + 8 + len)]);
    off += 12 + len;
  }
  const raw = inflateSync(idat);
  let dark = 0;
  let light = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = raw[y * (w + 1) + 1 + x]!;
      if (v < 64) dark++;
      else if (v === 255) light++;
    }
  }
  check("render: ink along the strokes", dark > 400 && dark < 5000, true);
  check("render: white elsewhere", light > w * h * 0.9, true);
  const wide = renderSignaturePng({ width: 2000, height: 1000, strokes: [line(0, 0, 2000, 1000)] });
  check("render: a wide pad is scaled down", [wide.readUInt32BE(16), wide.readUInt32BE(20)], [1000, 500]);
  check(
    "render: a scribble past the render limit is measured as such",
    renderInk({ width: 2000, height: 1000, strokes: [zigzag(150)] }) > MAX_RENDER_INK,
    true,
  );
  const started = Date.now();
  const heaviest = { width: 2000, height: 1000, strokes: [zigzag(130)] };
  renderSignaturePng(heaviest);
  const ms = Date.now() - started;
  check("render: the heaviest allowed signature draws in under a second", renderInk(heaviest) <= MAX_RENDER_INK && ms < 1000, true);
  console.log(`        (${Math.round(renderInk(heaviest))} px of ink in ${ms} ms)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;

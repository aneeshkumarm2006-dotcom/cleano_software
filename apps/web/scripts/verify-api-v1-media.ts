// API v1 job media: the pure rules. No database, no server, no network.
//
//   npx tsx scripts/verify-api-v1-media.ts
//
// The upload signature (deterministic, checked against the Cloudinary SDK's
// own api_sign_request with a made-up secret), where a key may live, what a
// stored file's first bytes must be, and which URLs may go to the app.
import { v2 as cloudinary } from "cloudinary";

import {
  ALLOWED_UPLOAD_FORMATS,
  cloudinarySignature,
  formatAllowed,
  isDeliverableImageUrl,
  jobPhotoPrefix,
  keyIsUnder,
  newPublicId,
  publicIdFromUrl,
  sniffImage,
  sniffMatchesFormat,
  thumbnailUrl,
  uploadParamsToSign,
} from "../src/server/media/keys";

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

// ── Where a key may live ────────────────────────────────────────────────────
const prefix = jobPhotoPrefix("acme", "job123", "user456");
check("prefix: org folder, job, person", prefix, "awer/acme/jobs/job123/user456/");
const key = newPublicId(prefix);
check("a new key is under its prefix", keyIsUnder(key, prefix), true);
check("a new key is 128 random bits in hex", /^[a-f0-9]{32}$/.test(key.slice(prefix.length)), true);
check("two keys differ", newPublicId(prefix) === newPublicId(prefix), false);
check("a teammate's key is not under mine", keyIsUnder(newPublicId(jobPhotoPrefix("acme", "job123", "mate")), prefix), false);
check("another job's key is not under mine", keyIsUnder(newPublicId(jobPhotoPrefix("acme", "job999", "user456")), prefix), false);
check("another company's key is not under mine", keyIsUnder(newPublicId(jobPhotoPrefix("other", "job123", "user456")), prefix), false);
check("a key the app named is refused", keyIsUnder(`${prefix}my-photo`, prefix), false);
check("a path under the prefix is refused", keyIsUnder(`${prefix}${"a".repeat(32)}/x`, prefix), false);
check("traversal is refused", keyIsUnder(`${prefix}../../other/${"a".repeat(32)}`, prefix), false);
let threw = false;
try {
  jobPhotoPrefix("acme", "../x", "u");
} catch {
  threw = true;
}
check("an id with a slash can't build a prefix", threw, true);

// ── The signature ───────────────────────────────────────────────────────────
const SECRET = "not-a-real-secret";
const params = uploadParamsToSign("awer/acme/jobs/j/u/" + "0".repeat(32), 1_790_000_000);
check("signed params are exactly these", Object.keys(params).sort(), ["allowed_formats", "overwrite", "public_id", "timestamp"]);
check("formats are image only", params.allowed_formats, "jpg,png,heic,heif,webp");
check("overwrite is off", params.overwrite, "false");
check(
  "signature is deterministic",
  cloudinarySignature(params, SECRET),
  cloudinarySignature({ ...params }, SECRET),
);
check("signature matches the Cloudinary SDK", cloudinarySignature(params, SECRET), cloudinary.utils.api_sign_request(params, SECRET));
check(
  "signature is Cloudinary's documented recipe",
  cloudinarySignature({ public_id: "sample_image", timestamp: 1315060510 }, "abcd"),
  // sha1("public_id=sample_image&timestamp=1315060510abcd"), from Cloudinary's docs.
  "b4ad47fb4e25c7bf5f92a20089f9db59bc302313",
);
check(
  "a changed field breaks the signature",
  cloudinarySignature({ ...params, overwrite: "true" }, SECRET) === cloudinarySignature(params, SECRET),
  false,
);
check(
  "an added field breaks the signature",
  cloudinarySignature({ ...params, folder: "elsewhere" }, SECRET) === cloudinarySignature(params, SECRET),
  false,
);

// ── What a stored file must be ──────────────────────────────────────────────
const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
check("JPEG", sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10)), "jpeg");
check("PNG", sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)), "png");
check("WebP", sniffImage(cat(ascii("RIFF"), bytes(0, 0, 0, 0), ascii("WEBPVP8 "))), "webp");
check("HEIC", sniffImage(cat(bytes(0, 0, 0, 0x18), ascii("ftypheic"), bytes(0, 0, 0, 0))), "heic");
check("HEIF (mif1)", sniffImage(cat(bytes(0, 0, 0, 0x18), ascii("ftypmif1"), bytes(0, 0, 0, 0))), "heic");
check("an MP4 is not a photo", sniffImage(cat(bytes(0, 0, 0, 0x18), ascii("ftypisom"), bytes(0, 0, 0, 0))), null);
check("a PDF is not a photo", sniffImage(ascii("%PDF-1.7\n%âãÏÓ")), null);
check("an SVG is not a photo", sniffImage(ascii("<svg xmlns=\"http://www.w3.org/2000/svg\">")), null);
check("HTML is not a photo", sniffImage(ascii("<!doctype html><html>")), null);
check("GIF is not on the list", sniffImage(ascii("GIF89a......")), null);
check("empty is nothing", sniffImage(new Uint8Array()), null);
check("JPEG bytes agree with jpg", sniffMatchesFormat("jpeg", "jpg"), true);
check("PNG bytes don't agree with jpg", sniffMatchesFormat("png", "jpg"), false);
check("HEIC bytes agree with heif", sniffMatchesFormat("heic", "heif"), true);
for (const f of ALLOWED_UPLOAD_FORMATS) check(`format ${f} allowed`, formatAllowed(f), true);
for (const f of ["gif", "svg", "pdf", "mp4", "", null]) check(`format ${f} refused`, formatAllowed(f as string | null), false);

// ── What may go to the app ──────────────────────────────────────────────────
const stored = "https://res.cloudinary.com/demo/image/upload/v1712345678/awer/acme/jobs/j/u/abc.jpg";
check("a stored photo is deliverable", isDeliverableImageUrl(stored), true);
check("http is not", isDeliverableImageUrl(stored.replace("https:", "http:")), false);
check("another host is not", isDeliverableImageUrl("https://evil.example/image/upload/x.jpg"), false);
check("a lookalike host is not", isDeliverableImageUrl("https://res.cloudinary.com.evil.example/x.jpg"), false);
check("javascript: is not", isDeliverableImageUrl("javascript:alert(1)"), false);
check("credentials in the URL are not", isDeliverableImageUrl("https://a:b@res.cloudinary.com/x.jpg"), false);
check(
  "thumbnail: a transformation of the same asset",
  thumbnailUrl(stored),
  "https://res.cloudinary.com/demo/image/upload/c_fill,g_auto,w_320,h_320,q_auto,f_auto/v1712345678/awer/acme/jobs/j/u/abc.jpg",
);
check("no thumbnail for a foreign URL", thumbnailUrl("https://evil.example/image/upload/x.jpg"), null);
check("public_id from a stored URL, as the web reads it", publicIdFromUrl(stored), "awer/acme/jobs/j/u/abc");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;

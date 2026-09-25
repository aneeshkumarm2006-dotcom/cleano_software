// Where a phone's upload may live, and what a stored file must look like.
// Pure: no database, no network, no server-only marker, so the verify script
// can check every rule here without a server (scripts/verify-api-v1-media.ts).
//
// The rules come from packages/api/src/v1/photos.ts:
//   - the server names every asset: <org folder>/jobs/<jobId>/<userId>/<random>,
//     with the org folder as the web names it (orgFolderFor);
//   - a key is accepted only under the caller's own prefix;
//   - a stored file is one of jpg, png, heic, heif or webp, at most 10 MB, and
//     its first bytes say so too.
import { createHash, randomBytes } from "node:crypto";

import { orgFolderFor } from "@/lib/asset-paths";

/** What the signature allows Cloudinary to store. Cloudinary names JPEG "jpg". */
export const ALLOWED_UPLOAD_FORMATS = ["jpg", "png", "heic", "heif", "webp"] as const;

/** How long Cloudinary honours a signature, from its timestamp. */
export const UPLOAD_SIGNATURE_TTL_S = 60 * 60;

const ID_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const RANDOM_PART = /^[a-f0-9]{32}$/;

/** `awer/<slug>/jobs/<jobId>/<userId>/` — everything one person may add to one job. */
export function jobPhotoPrefix(orgSlug: string, jobId: string, userId: string): string {
  if (!ID_SEGMENT.test(orgSlug) || !ID_SEGMENT.test(jobId) || !ID_SEGMENT.test(userId)) {
    throw new Error("jobPhotoPrefix: unexpected characters in an id");
  }
  return `${orgFolderFor(orgSlug)}/jobs/${jobId}/${userId}/`;
}

/** A fresh public_id under `prefix`: 128 random bits, never chosen by the app. */
export function newPublicId(prefix: string): string {
  return `${prefix}${randomBytes(16).toString("hex")}`;
}

/** Whether `key` is exactly a public_id this server could have made under `prefix`. */
export function keyIsUnder(key: string, prefix: string): boolean {
  if (!key.startsWith(prefix)) return false;
  return RANDOM_PART.test(key.slice(prefix.length));
}

/**
 * Cloudinary's request signature (api_sign_request): the parameters sorted by
 * name, joined as `k=v&k=v`, with the secret appended, then hashed. Spelled out
 * here so the verify script can pin it; the store uses the SDK's own, and the
 * verify script checks the two agree.
 */
export function cloudinarySignature(
  params: Record<string, string | number>,
  secret: string,
  algorithm: "sha1" | "sha256" = "sha1",
): string {
  const payload = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash(algorithm).update(payload + secret).digest("hex");
}

/** The exact parameters a job photo upload is signed with. */
export function uploadParamsToSign(publicId: string, timestampS: number): Record<string, string | number> {
  return {
    allowed_formats: ALLOWED_UPLOAD_FORMATS.join(","),
    overwrite: "false",
    public_id: publicId,
    timestamp: timestampS,
  };
}

/** Whether Cloudinary's reported format is one we take. */
export function formatAllowed(format: string | null | undefined): boolean {
  const f = (format ?? "").toLowerCase();
  return f === "jpeg" || (ALLOWED_UPLOAD_FORMATS as readonly string[]).includes(f);
}

export type SniffedImage = "jpeg" | "png" | "webp" | "heic";

/**
 * What the file's first bytes say it is. Only the four families the web
 * accepts; anything else (a PDF renamed .jpg, an SVG, HTML) is null.
 */
export function sniffImage(head: Uint8Array): SniffedImage | null {
  const b = head;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "png";
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  // ISO base media: [size:4]["ftyp"][major brand:4]. HEIC/HEIF brands only.
  if (b.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"].includes(brand)) {
      return "heic";
    }
  }
  return null;
}

/** Whether the sniffed family matches the format Cloudinary reported. */
export function sniffMatchesFormat(sniffed: SniffedImage, format: string): boolean {
  const f = format.toLowerCase();
  if (sniffed === "jpeg") return f === "jpg" || f === "jpeg";
  if (sniffed === "heic") return f === "heic" || f === "heif";
  return sniffed === f;
}

/**
 * A URL the app may be handed: https on res.cloudinary.com, the only image
 * host it loads (API_V1.md §4, "Only stored URLs go out").
 */
export function isDeliverableImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "res.cloudinary.com" && !u.username && !u.password && !u.port;
  } catch {
    return false;
  }
}

/** `https://res.cloudinary.com/<cloud>/image/upload/` for one cloud. */
export function deliveryPrefix(cloudName: string): string {
  return `https://res.cloudinary.com/${cloudName}/image/upload/`;
}

/** A small square version of a stored photo, for the grid. Null when it isn't a Cloudinary upload URL. */
export function thumbnailUrl(url: string): string | null {
  if (!isDeliverableImageUrl(url)) return null;
  const marker = "/image/upload/";
  const at = url.indexOf(marker);
  if (at === -1) return null;
  return `${url.slice(0, at + marker.length)}c_fill,g_auto,w_320,h_320,q_auto,f_auto/${url.slice(at + marker.length)}`;
}

/**
 * The public_id inside a stored delivery URL, as the web's deleteJobPhoto
 * reads it: the path after `/upload/`, without the version and extension.
 */
export function publicIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("res.cloudinary.com")) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const uploadIdx = parts.indexOf("upload");
    if (uploadIdx === -1) return null;
    let after = parts.slice(uploadIdx + 1);
    if (after[0] && /^v\d+$/.test(after[0])) after = after.slice(1);
    if (after.length === 0) return null;
    const last = after[after.length - 1].replace(/\.[^.]+$/, "");
    after[after.length - 1] = last;
    return after.join("/");
  } catch {
    return null;
  }
}

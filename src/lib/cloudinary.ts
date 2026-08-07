import { v2 as cloudinary } from "cloudinary";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (cloudName && apiKey && apiSecret) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
}

/** Whether the three credentials above are present. */
export function cloudinaryConfigured(): boolean {
  return !!(cloudName && apiKey && apiSecret);
}

/**
 * A short-lived, signed delivery URL for an asset uploaded with
 * `type: "authenticated"` (awerfixes.pdf item 16, decision 7).
 *
 * Authenticated assets are the only private storage mode in this codebase —
 * every other upload here is a public `/upload/` URL that anyone holding the
 * link can fetch forever. An authenticated asset is refused without a valid
 * signature, so possession of the stored `fileUrl` grants nothing; access is
 * whatever this function hands out, for as long as it says.
 *
 * `expires_at` is seconds since epoch, not milliseconds — getting that wrong
 * yields a URL that either expired in 1970 or never expires.
 *
 * Returns null when Cloudinary is not configured, so callers surface "not
 * configured" rather than crashing on a half-built environment.
 */
export function signedFileUrl(opts: {
  publicId: string;
  /** Cloudinary resource_type the asset was stored under. */
  resourceType: string;
  /** How long the link stays good. Kept short — it is a banking document. */
  ttlSeconds?: number;
}): string | null {
  if (!cloudinaryConfigured()) return null;
  const ttl = opts.ttlSeconds ?? 300;
  return cloudinary.url(opts.publicId, {
    resource_type: opts.resourceType,
    type: "authenticated",
    sign_url: true,
    secure: true,
    expires_at: Math.floor(Date.now() / 1000) + ttl,
  });
}

export { cloudinary };

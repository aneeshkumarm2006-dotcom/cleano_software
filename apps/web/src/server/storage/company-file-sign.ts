// Short-lived signed URLs for, and the bytes of, a file on the company's own
// Cloudinary folder. The URL is always rebuilt from parsed parts
// (./company-file-url), never passed through as stored, and only ever points
// at res.cloudinary.com.
import "server-only";

import { cloudinary, cloudinaryConfigured } from "@/lib/cloudinary";

import type { CompanyFile } from "./company-file-url";

export function cloudName(): string | undefined {
  return process.env.CLOUDINARY_CLOUD_NAME || undefined;
}

/** A signed delivery URL good for `ttlSeconds`, or null when storage isn't configured. */
export function signCompanyFile(file: CompanyFile, ttlSeconds = 600): string | null {
  if (!cloudinaryConfigured()) return null;
  const url = cloudinary.url(file.publicId, {
    resource_type: file.resourceType,
    type: file.deliveryType,
    ...(file.format ? { format: file.format } : {}),
    sign_url: true,
    secure: true,
    expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
  // Belt and braces: whatever the SDK built must still be our storage host.
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname !== "res.cloudinary.com") return null;
  } catch {
    return null;
  }
  return url;
}

const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * The file's bytes, read through a freshly signed URL. Bounded in size and
 * time, redirects refused. Throws when it can't be read: a document whose file
 * can't be hashed is not one anyone can be asked to sign.
 */
export async function fetchCompanyFileBytes(file: CompanyFile): Promise<Buffer> {
  const url = signCompanyFile(file, 120);
  if (!url) throw new Error("company storage is not configured");
  const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(`company file fetch answered ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_FILE_BYTES) throw new Error("company file too large to hash");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FILE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error("company file too large to hash");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

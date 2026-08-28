"use server";

import { cloudinary, cloudinaryConfigured } from "@/lib/cloudinary";
import { headers } from "next/headers";
import {
  BOOKING_PHOTO_MAX_BYTES,
  BOOKING_PHOTO_MIME_TYPES,
} from "@/lib/booking-deposit";
import { bookingPhotoFolderFor, currentOrgSlug } from "@/lib/asset-folder";
import type { UploadApiResponse } from "cloudinary";

/**
 * Photo upload for the PUBLIC booking flow (PDF #9, Stage 11): *"the client
 * uploads pictures of the space during booking"*.
 *
 * ## Why this is a separate action from `uploadJobPhoto`
 *
 * `uploadJobPhoto` requires a session and an existing job, and neither exists
 * here. The booking is a guest flow, and the job is not created until
 * `submitBooking` runs — after these photos have been chosen. So this action
 * uploads to storage ONLY and hands the URL back; `submitBooking` is what
 * attaches it to the job it creates, and it re-validates every URL against
 * `isBookingPhotoUrl` before it does.
 *
 * That ordering is deliberate. The alternative — create the job first, then
 * upload — would mean a job row for every abandoned booking.
 *
 * ## What guards an unauthenticated upload endpoint
 *
 * There is no session to check, so the limits are the guard:
 *
 *   1. MIME allow-list and a 10 MB ceiling, enforced on the server against the
 *      real bytes, not on the browser against a filename.
 *   2. A per-IP rate limit (below), so one client cannot fill the media library.
 *   3. Uploads land in their own folder with `overwrite: false`, so nothing here
 *      can replace an existing asset — including a job photo or a signed
 *      employee document.
 *   4. Nothing is written to the database. A flood costs storage, never rows,
 *      and never a job a cleaner might be sent to.
 *
 * The folder is also the trust boundary at the far end: `submitBooking` accepts a
 * URL only if it points inside `BOOKING_PHOTO_FOLDER` on our own cloud, so the
 * action cannot be used to attach an arbitrary internet image — or another job's
 * photo — to a booking.
 */

/* ------------------------------- rate limiting ---------------------------- */
//
// In-memory, per-instance, best-effort. Deliberately NOT presented as
// airtight: a serverless deploy runs several instances and each keeps its own
// counter, so the real ceiling is `LIMIT × instances`. It is here to stop the
// obvious abuse (a script looping on one connection) at zero infrastructure
// cost; a durable limiter belongs at the edge, alongside the one every other
// public action in this app would also want.

const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT = 40; // ≈ 4 bookings' worth of photos per IP per window

const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  // Opportunistic sweep — the map would otherwise grow for the life of the
  // instance. Cheap: it only runs on the request that finds an expired entry.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }
  const entry = hits.get(ip);
  if (!entry || entry.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

/**
 * Best-effort client IP. `x-forwarded-for` is a client-settable header, so this
 * is a rate-limit bucket key and nothing more — it is never used for authorization.
 */
async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? "unknown";
}

// Folder passed in: this returns a Promise but is not async, and the company
// must be resolved before the stream opens.
function streamUpload(
  buffer: Buffer,
  publicId: string,
  folder: string
): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: "image",
        // Never replace an existing asset — see guard (3) in the header.
        overwrite: false,
        // Give slow phone uploads room, as uploadJobPhoto does; without this the
        // default is short and a large HEIC on a cell connection silently fails.
        timeout: 90_000,
      },
      (error, result) => {
        if (error || !result) reject(error || new Error("Upload failed"));
        else resolve(result);
      }
    );
    stream.end(buffer);
  });
}

export type UploadBookingPhotoResult =
  | { success: true; url: string; publicId: string }
  | { success: false; error: string };

export async function uploadBookingPhoto(
  formData: FormData
): Promise<UploadBookingPhotoResult> {
  const file = formData.get("file");

  if (!file || typeof file === "string") {
    return { success: false, error: "No file provided" };
  }
  if (file.size === 0) {
    return { success: false, error: "That file is empty. Please pick another." };
  }
  if (file.size > BOOKING_PHOTO_MAX_BYTES) {
    return {
      success: false,
      error: `That photo is larger than ${Math.round(
        BOOKING_PHOTO_MAX_BYTES / (1024 * 1024)
      )} MB. Please pick a smaller one.`,
    };
  }
  if (!BOOKING_PHOTO_MIME_TYPES.includes(file.type.toLowerCase())) {
    return {
      success: false,
      error: "Unsupported file type. Use JPG, PNG, HEIC, or WebP.",
    };
  }

  if (!cloudinaryConfigured()) {
    // Names the real cause without leaking configuration detail to the public.
    console.error("uploadBookingPhoto: Cloudinary is not configured");
    return {
      success: false,
      error:
        "Photo uploads are temporarily unavailable. Please try again shortly, or contact us.",
    };
  }

  if (rateLimited(await clientIp())) {
    return {
      success: false,
      error: "Too many uploads from this connection. Please wait a few minutes.",
    };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const publicId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const result = await streamUpload(
      buffer,
      publicId,
      bookingPhotoFolderFor(await currentOrgSlug())
    );
    return { success: true, url: result.secure_url, publicId: result.public_id };
  } catch (error) {
    console.error("uploadBookingPhoto: upload failed", error);
    return {
      success: false,
      error: "That photo didn't upload. Please try again.",
    };
  }
}

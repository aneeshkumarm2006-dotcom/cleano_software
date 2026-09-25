// Job photos: before and after photos a cleaner takes on a job, and the signed
// upload that carries them.
//
// Photos never pass through a server function (API_V1.md §7). The app asks
// for a short-lived signed URL, PUTs the file straight to storage, then
// attaches the stored object to the job by its key. The server checks the
// person, the job, the size and the type when it signs, and checks the key and
// the stored object again when it attaches — the app is never the authority on
// either.
//
// The web's rules, which the server applies to both front doors
// (apps/web/src/app/admin/actions/uploadJobPhoto.ts and
// packages/core/src/jobs/job-photos.ts):
//   - at most MAX_PHOTOS_PER_JOB photos on one job (200 today);
//   - at most 10 MB each, JPEG, PNG, HEIC, HEIF or WebP;
//   - after-photos can be turned off per job by an admin. Before-photos are
//     always welcome (core `photoExpectationLine`).
import { z } from "zod";

import { Instant, openEnum, page } from "./common";

/** How a photo is filed. A copy of core's `JOB_PHOTO_KINDS`, frozen for v1. */
export const JOB_PHOTO_KINDS = ["BEFORE", "AFTER", "ISSUE", "GENERAL"] as const;

/**
 * What a cleaner files a photo under from the photos screen. ISSUE photos are
 * attached through a report (./issues.ts); GENERAL is what older uploads and
 * the client's booking photos are.
 */
export const PHOTO_PHASES = ["BEFORE", "AFTER"] as const;
export type PhotoPhase = (typeof PHOTO_PHASES)[number];

/** What an upload is for. One value now; documents and chat files come later. */
export const UPLOAD_PURPOSES = ["JOB_PHOTO"] as const;

/** The file types the web accepts for a job photo. */
export const PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"] as const;
export type PhotoContentType = (typeof PHOTO_CONTENT_TYPES)[number];

/** The web's per-file ceiling, in bytes. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** How the app sends the file to a signed URL. Only PUT is understood by v1 builds. */
export const UPLOAD_METHODS = ["PUT"] as const;

/**
 * A URL the app will load or send to. https only: a signed URL or an image
 * the server hands back must never be http, a custom scheme, or `javascript:`.
 */
export const HttpsUrl = z.url({ protocol: /^https$/, hostname: z.regexes.domain });

// ── Uploads ─────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/uploads
 *
 * Signs one upload. The server must:
 *   - allow only the `staff` roles, as every v1 route;
 *   - for JOB_PHOTO, check the caller is assigned to `jobId` in this company
 *     (not assigned and not found both answer 404);
 *   - refuse a `byteSize` over MAX_PHOTO_BYTES or a type outside
 *     PHOTO_CONTENT_TYPES (400), and refuse when the job already has
 *     MAX_PHOTOS_PER_JOB photos (409 `PHOTO_LIMIT_REACHED`, message says so);
 *   - refuse when the job no longer takes photos (409 `PHOTOS_CLOSED`: paid,
 *     cancelled);
 *   - sign for exactly this content type and length, so the storage provider
 *     itself refuses a different or larger file, and expire within 15 minutes;
 *   - choose the key itself, under `<orgId>/jobs/<jobId>/<userId>/`, with a
 *     random name. The app never names an object.
 */
export const UploadRequest = z.object({
  purpose: z.enum(UPLOAD_PURPOSES),
  jobId: z.string().min(1),
  contentType: z.enum(PHOTO_CONTENT_TYPES),
  byteSize: z.number().int().min(1).max(MAX_PHOTO_BYTES),
});
export type UploadRequest = z.infer<typeof UploadRequest>;

export const UploadTicket = z.object({
  /** Where to send the file. Signed, short-lived, and https. */
  uploadUrl: HttpsUrl,
  /** An unknown method means this build can't do the upload: it says so. */
  method: openEnum(UPLOAD_METHODS),
  /** Headers the PUT must carry exactly (the signature covers them). */
  headers: z.record(z.string(), z.string()),
  /** The stored object's key, to attach it afterwards. Opaque to the app. */
  key: z.string().min(1),
  /** After this the URL no longer works; the app asks for a new one. */
  expiresAt: Instant,
});
export type UploadTicket = z.infer<typeof UploadTicket>;

// ── Photos on a job ─────────────────────────────────────────────────────────

export const JobPhoto = z.object({
  id: z.string(),
  kind: openEnum(JOB_PHOTO_KINDS),
  /** The full photo. */
  url: HttpsUrl,
  /** A small square version for the grid, when storage can make one. */
  thumbnailUrl: HttpsUrl.nullable(),
  caption: z.string().nullable(),
  takenAt: Instant,
  /**
   * Who added it, as a first name ("Sofia"), or null for a photo the client
   * added when booking. Never an email or a surname.
   */
  takenBy: z.string().nullable(),
  /** This person added it. */
  mine: z.boolean(),
  /** This person may delete it: their own, and never a client's booking photo. */
  canDelete: z.boolean(),
});
export type JobPhoto = z.infer<typeof JobPhoto>;

/** What this person may add to this job right now, decided by the server. */
export const PhotoPolicy = z.object({
  /** False once the job is paid or cancelled, or the cleaner is off it. */
  canAdd: z.boolean(),
  /** Why not, in words for the cleaner, when `canAdd` is false. */
  closedReason: z.string().nullable(),
  /** False when an admin turned after-photos off for this job. */
  afterPhotosAllowed: z.boolean(),
  /** The per-job cap (MAX_PHOTOS_PER_JOB), shown before anything is picked. */
  maxPhotos: z.number().int(),
  /** The per-file cap in bytes, checked on the phone before asking to upload. */
  maxBytes: z.number().int(),
});
export type PhotoPolicy = z.infer<typeof PhotoPolicy>;

/**
 * GET /api/v1/jobs/:id/photos?cursor=…
 *
 * Every photo on the job, newest first, as the web's gallery shows a cleaner
 * on the job: the crew's photos and the client's booking photos. The server
 * must check the caller is assigned to the job (404 otherwise), and work out
 * `mine` and `canDelete` from the session — never from anything the app sent.
 */
export const JobPhotosResponse = page(JobPhoto).extend({
  /** All photos on the job, across pages: "12 of 200". */
  total: z.number().int(),
  policy: PhotoPolicy,
});
export type JobPhotosResponse = z.infer<typeof JobPhotosResponse>;

/**
 * POST /api/v1/jobs/:id/photos — attach an uploaded file to the job.
 * Idempotent on `clientEventId` (also the Idempotency-Key): a retry returns
 * the same photo, and never adds a second row or a second email.
 *
 * The server must:
 *   - check the caller is assigned to the job (404);
 *   - check the key sits under this company's, this job's, and this CALLER's
 *     prefix, and was signed for them — a key from anyone else is 404;
 *   - check the object exists in storage and is within the size and type it
 *     was signed for (409 `UPLOAD_MISSING` if not, retryable: the PUT may still
 *     be landing);
 *   - refuse AFTER when after-photos are off for this job (409
 *     `AFTER_PHOTOS_OFF`). BEFORE is always accepted. (The web action today
 *     refuses BEFORE too when after-photos are off, against its own on-page
 *     copy; the shared service should settle on core's rule.)
 *   - re-check the per-job cap at attach time, in the same transaction as the
 *     insert;
 *   - send the "first photos on this job" email to the office as the web does,
 *     once per job.
 */
export const AttachPhotoRequest = z.object({
  key: z.string().min(1).max(512),
  phase: z.enum(PHOTO_PHASES),
  clientEventId: z.uuid(),
});
export type AttachPhotoRequest = z.infer<typeof AttachPhotoRequest>;

/**
 * DELETE /api/v1/jobs/:id/photos/:photoId
 *
 * The server must allow it only for the caller's OWN photo on this job; a
 * teammate's photo, a client's booking photo, or a photo on another job all
 * answer 404. It removes the stored object as well as the row. A second
 * delete of the same photo answers 404, which the app treats as done.
 */
export const DeletePhotoResponse = z.object({ id: z.string() });
export type DeletePhotoResponse = z.infer<typeof DeletePhotoResponse>;

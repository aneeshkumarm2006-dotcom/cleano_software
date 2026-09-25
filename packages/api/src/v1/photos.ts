// Job photos: before and after photos a cleaner takes on a job, and the signed
// upload that carries them.
//
// Photos live in Cloudinary, as the web's do (apps/web/src/app/admin/actions/
// uploadJobPhoto.ts), and never pass through a server function (API_V1.md
// §7). The app asks the server to sign an upload, POSTs the file straight to
// Cloudinary as a multipart form, then attaches the stored asset to the job by
// its public_id. The server checks the person, the job, the size and the type
// when it signs, and checks the public_id and the stored asset again when it
// attaches — the app is never the authority on either.
//
// The web's rules, which the server applies to both front doors
// (apps/web/src/app/admin/actions/uploadJobPhoto.ts and
// packages/core/src/jobs/job-photos.ts):
//   - at most MAX_PHOTOS_PER_JOB photos on one job (200 today);
//   - at most 10 MB each, JPEG, PNG, HEIC, HEIF or WebP;
//   - an admin can turn photos off for a job (the web's "after-photos"
//     switch, core `afterPhotosAllowed`). When they're off the job takes no
//     photos at all, before or after, as the web's upload refuses both. Only
//     an issue report's photo still goes on (./issues.ts).
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

/**
 * How the app sends the file. MULTIPART_POST: a multipart/form-data POST to
 * Cloudinary's upload API, carrying the ticket's `fields` and the file. A
 * build that doesn't know the method says it can't send photos any more.
 */
export const UPLOAD_METHODS = ["MULTIPART_POST"] as const;

/**
 * A URL the app will load or send to. https only: a signed URL or an image
 * the server hands back must never be http, a custom scheme, or `javascript:`.
 */
export const HttpsUrl = z.url({ protocol: /^https$/, hostname: z.regexes.domain });

// ── Uploads ─────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/uploads
 *
 * Signs one direct upload to Cloudinary. The server must:
 *   - allow only the `staff` roles, as every v1 route;
 *   - for JOB_PHOTO, check the caller is assigned to `jobId` in this company
 *     (not assigned and not found both answer 404);
 *   - refuse a `byteSize` over MAX_PHOTO_BYTES or a type outside
 *     PHOTO_CONTENT_TYPES (400), and refuse when the job already has
 *     MAX_PHOTOS_PER_JOB photos (409 `PHOTO_LIMIT_REACHED`, message says so);
 *   - refuse when the job no longer takes photos (409 `PHOTOS_CLOSED`: paid,
 *     cancelled). It does NOT refuse for the photo switch: the same ticket
 *     carries an issue report's photo, which the switch doesn't cover. That
 *     is checked when the photo is attached;
 *   - choose the public_id itself, under the company's folder as the web names
 *     it (`orgFolderFor(slug)` in apps/web/src/lib/asset-paths.ts), then
 *     `/jobs/<jobId>/<userId>/<random>`. The app never names an asset;
 *   - sign, with CLOUDINARY_API_SECRET (which never leaves the server) and the
 *     Cloudinary SDK's `api_sign_request`, exactly the parameters it returns
 *     in `fields`: `public_id`, a fresh `timestamp` (seconds, taken now),
 *     `allowed_formats` of jpg, png, heic, heif and webp, and
 *     `overwrite=false`, so an asset can't be replaced; plus `api_key`, which
 *     Cloudinary needs but doesn't sign. A signed `upload_preset` may add the
 *     account's size limit and an incoming resize. A signature can't pin
 *     the file's exact byte length, so the size is enforced again when the
 *     photo is attached (below);
 *   - say `expiresAt` = timestamp + 1 hour: Cloudinary refuses a signature
 *     older than that. The app doesn't wait that long; it asks for a new
 *     ticket once one is 10 minutes old.
 */
export const UploadRequest = z.object({
  purpose: z.enum(UPLOAD_PURPOSES),
  jobId: z.string().min(1).max(64),
  contentType: z.enum(PHOTO_CONTENT_TYPES),
  byteSize: z.number().int().min(1).max(MAX_PHOTO_BYTES),
});
export type UploadRequest = z.infer<typeof UploadRequest>;

export const UploadTicket = z.object({
  /**
   * Where to POST the file: always
   * `https://api.cloudinary.com/v1_1/<cloud>/image/upload`. The app refuses
   * any other address.
   */
  uploadUrl: HttpsUrl,
  /** An unknown method means this build can't do the upload: it says so. */
  method: openEnum(UPLOAD_METHODS),
  /**
   * Form fields to send exactly as given, and no others: `api_key`,
   * `timestamp`, `signature` and the signed parameters. The signature covers
   * them, so a changed or added field makes Cloudinary refuse the upload.
   */
  fields: z.record(z.string(), z.string()),
  /** The form field that carries the file ("file"). */
  fileField: z.string().min(1).max(64),
  /** The asset's Cloudinary public_id, to attach it afterwards. Opaque to the app. */
  key: z.string().min(1),
  /** After this the signature no longer works; the app asks for a new one. */
  expiresAt: Instant,
});
export type UploadTicket = z.infer<typeof UploadTicket>;

// ── Photos on a job ─────────────────────────────────────────────────────────

export const JobPhoto = z.object({
  id: z.string(),
  kind: openEnum(JOB_PHOTO_KINDS),
  /**
   * The full photo, a Cloudinary delivery URL on res.cloudinary.com (the
   * only image host the app loads). These are photos of the inside of
   * clients' homes, so authenticated, signed delivery that expires within an
   * hour is recommended over a public link. The web stores and shows public
   * `/image/upload/` URLs today, and its gallery and deleteJobPhoto read them
   * as such, so moving to authenticated assets means changing those too.
   */
  url: HttpsUrl,
  /** A small square version for the grid: a Cloudinary transformation of the same asset. */
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
  /**
   * False once the job is paid or cancelled, or the cleaner is off it, and
   * whenever `photosAllowed` is false.
   */
  canAdd: z.boolean(),
  /** Why not, in words for the cleaner, when `canAdd` is false. */
  closedReason: z.string().nullable(),
  /**
   * False when an admin turned photos off for this job (core
   * `afterPhotosAllowed`). Then nothing can be added, before or after, and
   * the app says the office turned photos off rather than `closedReason`.
   */
  photosAllowed: z.boolean(),
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
 *   - check the key (a Cloudinary public_id) sits under this company's, this
 *     job's, and this CALLER's prefix, and was signed for them — a key from
 *     anyone else is 404;
 *   - look the asset up with Cloudinary's Admin API (`api.resource`, image).
 *     Not there: 409 `UPLOAD_MISSING`, not retryable, and the app sends the
 *     file again on a new ticket. Cloudinary answers the upload only once the
 *     asset is stored, so a missing one was never sent;
 *   - check the asset's `format` is jpg, png, heic, heif or webp and its
 *     `bytes` are at most MAX_PHOTO_BYTES. Out of bounds: destroy the asset
 *     and answer 400 `UPLOAD_INVALID`;
 *   - refuse any phase, BEFORE or AFTER, when an admin turned photos off
 *     for this job (409 `PHOTOS_OFF`), as the web's upload does;
 *   - re-check the per-job cap at attach time, in the same transaction as the
 *     insert;
 *   - accept a key ONCE: an attached key is marked used, and attaching it
 *     again (other than an idempotent replay) is 409 `UPLOAD_USED`, so two
 *     rows never share one stored asset;
 *   - check the stored file's first bytes really are a JPEG, PNG, HEIC or
 *     WebP, not only the format Cloudinary reports;
 *   - store the photo's URL as the web does (the upload's `secure_url`), so
 *     the web's gallery and deleteJobPhoto work on it unchanged;
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
 * answer 404. It destroys the Cloudinary asset as well as the row, as the
 * web's deleteJobPhoto does. A second
 * delete of the same photo answers 404, which the app treats as done.
 */
export const DeletePhotoResponse = z.object({ id: z.string() });
export type DeletePhotoResponse = z.infer<typeof DeletePhotoResponse>;

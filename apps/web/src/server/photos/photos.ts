// Job photos: who may see and add them, the signed upload the phone uses, the
// attach that turns a stored asset into a JobPhoto row, and deleting one's own.
//
// Shared by both front doors:
//   - the web's actions (app/admin/actions/uploadJobPhoto.ts, deleteJobPhoto.ts,
//     getJobPhotos.ts) are thin adapters over jobForCrew, photoGate,
//     insertJobPhoto and deleteJobPhotoFor, with their messages unchanged;
//   - the phone's routes (api/v1/uploads, api/v1/jobs/:id/photos) use the
//     same pieces plus signJobPhotoUpload / attachUploadedPhoto.
//
// The rules are packages/api/src/v1/photos.ts, which is the spec.
import "server-only";

import type { JobPhotosResponse, UploadTicket } from "@bookmops/api/v1";
import { MAX_PHOTO_BYTES } from "@bookmops/api/v1";
import {
  afterPhotosAllowed,
  jobPhotoKindLabel,
  MAX_PHOTOS_PER_JOB,
  type JobPhotoKind,
} from "@bookmops/core/jobs";
import type { Prisma } from "@prisma/client";

import { cleanerAssignedWhere } from "@/lib/cleaner-jobs";
import type { ScopedTx } from "@/lib/db-scoped";
import { sendAdminJobPhotos } from "@/lib/email";
import { db } from "@/lib/org-db";

import type { Actor } from "../actor";
import { effect, type Effect } from "../effects";
import { failure, notFound, ok, type Failure, type Result } from "../result";
import {
  formatAllowed,
  isDeliverableImageUrl,
  jobPhotoPrefix,
  keyIsUnder,
  newPublicId,
  publicIdFromUrl,
  sniffImage,
  sniffMatchesFormat,
  thumbnailUrl,
  UPLOAD_SIGNATURE_TTL_S,
  uploadParamsToSign,
  deliveryPrefix,
} from "../media/keys";
import { mediaStore, type StoredAsset } from "../media/store";

// ── Who is on the job ───────────────────────────────────────────────────────

/**
 * Which front door is asking. The web's actions keep their own rule (an
 * owner or admin may act on any job; otherwise the lead or a cleaner on it).
 * The phone is stricter: only jobs in the cleaner's own scope
 * (lib/cleaner-jobs.ts), so a soft-deleted job or an unsettled quote is 404.
 */
export type Door = "web" | "phone";

export const CREW_JOB_SELECT = {
  id: true,
  jobNumber: true,
  clientName: true,
  status: true,
  employeeId: true,
  afterPhotoConsent: true,
  afterPhotoOverrideAt: true,
  cleaners: { select: { id: true } },
} satisfies Prisma.JobSelect;

export type CrewJob = Prisma.JobGetPayload<{ select: typeof CREW_JOB_SELECT }>;

export const isOfficeAdmin = (actor: Actor) => actor.role === "OWNER" || actor.role === "ADMIN";

/**
 * The job, if this person may work with its photos and reports; otherwise
 * `{ job: null, reason }`. For the web the reason is its old message; the
 * phone answers 404 for both.
 */
export async function jobForCrew(
  actor: Actor,
  jobId: string,
  door: Door,
): Promise<{ job: CrewJob; reason?: undefined } | { job: null; reason: "NOT_FOUND" | "NOT_ON_JOB" }> {
  if (door === "phone") {
    const base = cleanerAssignedWhere(actor.userId);
    const job = await db.job.findFirst({
      where: { ...base, AND: [...(base.AND as Prisma.JobWhereInput[]), { id: jobId }] },
      select: CREW_JOB_SELECT,
    });
    return job ? { job } : { job: null, reason: "NOT_FOUND" };
  }
  const job = await db.job.findUnique({ where: { id: jobId }, select: CREW_JOB_SELECT });
  if (!job) return { job: null, reason: "NOT_FOUND" };
  const onJob = job.employeeId === actor.userId || job.cleaners.some((c) => c.id === actor.userId);
  if (!isOfficeAdmin(actor) && !onJob) return { job: null, reason: "NOT_ON_JOB" };
  return { job };
}

// ── Policy ──────────────────────────────────────────────────────────────────

/** Statuses after which a job takes no new photos from the phone (409 PHOTOS_CLOSED). */
const PHOTO_CLOSED_STATUSES = new Set(["PAID", "CANCELLED"]);

export const PHOTOS_OFF_MESSAGE =
  "After-photos are turned off for this job. Ask an admin to enable them before uploading.";

export function photoLimitMessage(count: number): string {
  return `This job already has ${count} photos (${MAX_PHOTOS_PER_JOB} is the maximum). Ask an admin before adding more.`;
}

/**
 * The photo switch (core afterPhotosAllowed), as the web applies it: to every
 * photo but an ISSUE one, and never to an owner or admin.
 */
export function photoSwitchBlocks(actor: Actor, job: CrewJob, kind: JobPhotoKind): boolean {
  return !isOfficeAdmin(actor) && kind !== "ISSUE" && !afterPhotosAllowed(job);
}

export function photoPolicy(job: CrewJob, count: number): JobPhotosResponse["policy"] {
  const photosAllowed = afterPhotosAllowed(job);
  const closed = PHOTO_CLOSED_STATUSES.has(job.status);
  const full = count >= MAX_PHOTOS_PER_JOB;
  const closedReason = !photosAllowed
    ? null
    : closed
      ? job.status === "CANCELLED"
        ? "This job was cancelled, so it doesn't take photos."
        : "This job is finished and paid, so it doesn't take photos."
      : full
        ? photoLimitMessage(count)
        : null;
  return {
    canAdd: photosAllowed && !closed && !full,
    closedReason,
    photosAllowed,
    maxPhotos: MAX_PHOTOS_PER_JOB,
    maxBytes: MAX_PHOTO_BYTES,
  };
}

// ── Listing (phone) ─────────────────────────────────────────────────────────

export const PHOTO_PAGE_SIZE = 30;

interface PhotoCursor {
  c: string;
  id: string;
}

function encodeCursor(c: PhotoCursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

/** Untrusted: a malformed cursor is "invalid", a good one only narrows the scoped query. */
export function decodeTimeCursor(raw: string | undefined): PhotoCursor | null | "invalid" {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (!v || typeof v !== "object") return "invalid";
    const { c, id } = v as Record<string, unknown>;
    if (typeof c !== "string" || typeof id !== "string" || id.length > 64) return "invalid";
    if (Number.isNaN(new Date(c).getTime())) return "invalid";
    return { c, id };
  } catch {
    return "invalid";
  }
}

export { encodeCursor as encodeTimeCursor };

/** Only photos the app may be handed: stored on res.cloudinary.com over https. */
const DELIVERABLE: Prisma.JobPhotoWhereInput = { url: { startsWith: "https://res.cloudinary.com/" } };

function firstName(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}

export async function listJobPhotos(
  actor: Actor,
  jobId: string,
  cursorRaw: string | undefined,
): Promise<Result<JobPhotosResponse>> {
  const cursor = decodeTimeCursor(cursorRaw);
  if (cursor === "invalid") return failure(400, "VALIDATION_FAILED", "That page link isn't valid. Refresh and try again.");

  const { job } = await jobForCrew(actor, jobId, "phone");
  if (!job) return notFound("This job isn't available.");

  const where: Prisma.JobPhotoWhereInput = { jobId: job.id, ...DELIVERABLE };
  const pageWhere: Prisma.JobPhotoWhereInput = cursor
    ? {
        AND: [
          where,
          {
            OR: [
              { createdAt: { lt: new Date(cursor.c) } },
              { createdAt: new Date(cursor.c), id: { lt: cursor.id } },
            ],
          },
        ],
      }
    : where;

  const [rows, total, all] = await Promise.all([
    db.jobPhoto.findMany({
      where: pageWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PHOTO_PAGE_SIZE + 1,
      select: {
        id: true,
        kind: true,
        url: true,
        caption: true,
        createdAt: true,
        employeeId: true,
        employee: { select: { name: true } },
      },
    }),
    db.jobPhoto.count({ where }),
    // The cap counts every photo on the job, as the web's does.
    db.jobPhoto.count({ where: { jobId: job.id } }),
  ]);

  const more = rows.length > PHOTO_PAGE_SIZE;
  const pageRows = more ? rows.slice(0, PHOTO_PAGE_SIZE) : rows;
  const last = pageRows[pageRows.length - 1];

  return ok({
    items: pageRows.map((p) => {
      const mine = !!p.employeeId && p.employeeId === actor.userId;
      return {
        id: p.id,
        kind: p.kind,
        url: p.url,
        thumbnailUrl: thumbnailUrl(p.url),
        caption: p.caption,
        takenAt: p.createdAt.toISOString(),
        takenBy: p.employeeId ? firstName(p.employee?.name) : null,
        mine,
        // Staff delete only their own; a client's booking photo (no uploader)
        // is never deletable from the phone.
        canDelete: mine,
      };
    }),
    nextCursor: more && last ? encodeCursor({ c: last.createdAt.toISOString(), id: last.id }) : null,
    total,
    policy: photoPolicy(job, all),
  });
}

// ── Signing an upload (phone) ───────────────────────────────────────────────

export async function signJobPhotoUpload(
  actor: Actor,
  input: { orgSlug: string; jobId: string; contentType: string; byteSize: number; now: Date },
): Promise<Result<UploadTicket>> {
  const store = mediaStore();
  const { job } = await jobForCrew(actor, input.jobId, "phone");
  if (!job) return notFound("This job isn't available.");

  if (PHOTO_CLOSED_STATUSES.has(job.status)) {
    return failure(409, "PHOTOS_CLOSED", photoPolicy(job, 0).closedReason ?? "This job doesn't take photos any more.");
  }
  const count = await db.jobPhoto.count({ where: { jobId: job.id } });
  if (count >= MAX_PHOTOS_PER_JOB) return failure(409, "PHOTO_LIMIT_REACHED", photoLimitMessage(count));

  if (!store.configured()) {
    console.error("upload sign: Cloudinary is not configured");
    return failure(409, "UPLOADS_UNAVAILABLE", "Photo uploads aren't available right now. Try again later.", true);
  }

  const publicId = newPublicId(jobPhotoPrefix(input.orgSlug, job.id, actor.userId));
  const timestamp = Math.floor(input.now.getTime() / 1000);
  const params = uploadParamsToSign(publicId, timestamp);
  const signature = store.sign(params);

  await db.mediaUpload.create({
    data: {
      userId: actor.userId,
      jobId: job.id,
      purpose: "JOB_PHOTO",
      publicId,
      contentType: input.contentType,
      byteSize: input.byteSize,
      expiresAt: new Date((timestamp + UPLOAD_SIGNATURE_TTL_S) * 1000),
    },
  });

  const fields: Record<string, string> = { api_key: store.apiKey(), signature };
  for (const [k, v] of Object.entries(params)) fields[k] = String(v);

  return ok({
    uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(store.cloudName())}/image/upload`,
    method: "MULTIPART_POST",
    fields,
    fileField: "file",
    key: publicId,
    expiresAt: new Date((timestamp + UPLOAD_SIGNATURE_TTL_S) * 1000).toISOString(),
  });
}

// ── Checking a stored upload (phone) ────────────────────────────────────────

export interface VerifiedUpload {
  uploadId: string;
  asset: StoredAsset;
}

/**
 * Everything POST /jobs/:id/photos checks about a key before a transaction:
 * this company, this job, this caller's prefix, issued to them and not used;
 * the asset exists, is an allowed format and size, and its bytes agree.
 * An asset that fails the format checks is destroyed.
 */
export async function verifyUploadedKey(
  actor: Actor,
  input: { orgSlug: string; jobId: string; key: string },
): Promise<Result<VerifiedUpload>> {
  const store = mediaStore();
  const prefix = jobPhotoPrefix(input.orgSlug, input.jobId, actor.userId);
  if (!keyIsUnder(input.key, prefix)) return notFound("This upload isn't available.");

  const upload = await db.mediaUpload.findFirst({
    where: { publicId: input.key, userId: actor.userId, jobId: input.jobId, purpose: "JOB_PHOTO" },
    select: { id: true, usedAt: true },
  });
  if (!upload) return notFound("This upload isn't available.");
  if (upload.usedAt) return usedFailure();

  if (!store.configured()) {
    console.error("upload attach: Cloudinary is not configured");
    return failure(409, "UPLOADS_UNAVAILABLE", "Photo uploads aren't available right now. Try again later.", true);
  }

  const found = await store.lookup(input.key);
  if (found.kind === "missing") {
    return failure(409, "UPLOAD_MISSING", "That photo didn't finish uploading. Send it again.");
  }
  if (found.kind === "unavailable") {
    return failure(409, "UPLOADS_UNAVAILABLE", "We couldn't check that photo just now. Try again in a moment.", true);
  }
  const asset = found.asset;
  const invalid = async () => {
    await store.destroy(input.key);
    return failure(400, "UPLOAD_INVALID", "That file isn't a photo we can take. Use JPG, PNG, HEIC or WebP, up to 10 MB.");
  };
  if (asset.publicId !== input.key) return invalid();
  if (!formatAllowed(asset.format) || asset.bytes < 1 || asset.bytes > MAX_PHOTO_BYTES) return invalid();
  if (!asset.secureUrl.startsWith(deliveryPrefix(store.cloudName())) || !isDeliverableImageUrl(asset.secureUrl)) {
    return invalid();
  }

  const head = await store.readHead(asset.secureUrl, 32);
  if (!head) {
    return failure(409, "UPLOADS_UNAVAILABLE", "We couldn't check that photo just now. Try again in a moment.", true);
  }
  const sniffed = sniffImage(head);
  if (!sniffed || !sniffMatchesFormat(sniffed, asset.format)) return invalid();

  return ok({ uploadId: upload.id, asset });
}

const usedFailure = () =>
  failure(409, "UPLOAD_USED", "That photo is already on the job.");

// ── Inserting a photo (both doors) ──────────────────────────────────────────

class TxRefusal extends Error {
  constructor(readonly failure: Failure) {
    super(failure.code);
  }
}

/**
 * Run `body` in one transaction with the job's row locked, so the per-job cap
 * and the attach-once rule hold under concurrent attaches. A Failure thrown
 * as TxRefusal rolls everything back and is returned.
 */
export async function withJobLocked<T>(
  jobId: string,
  organizationId: string,
  body: (tx: ScopedTx, refuse: (f: Failure) => never) => Promise<T>,
): Promise<Result<T>> {
  try {
    const value = await db.$transaction(async (tx: ScopedTx) => {
      await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${jobId} AND "organizationId" = ${organizationId} FOR UPDATE`;
      return body(tx, (f) => {
        throw new TxRefusal(f);
      });
    });
    return ok(value);
  } catch (e) {
    if (e instanceof TxRefusal) return e.failure;
    throw e;
  }
}

export interface InsertPhotoInput {
  job: CrewJob;
  actor: Actor;
  url: string;
  caption: string | null;
  kind: JobPhotoKind;
  /** The MediaUpload it came from (phone), marked used in the same transaction. */
  uploadId?: string;
}

export interface InsertedPhoto {
  photo: Prisma.JobPhotoGetPayload<object>;
  countBefore: number;
}

/**
 * Insert one photo inside a transaction the caller holds (with the job row
 * locked): the cap re-checked, the upload marked used once.
 */
export async function insertJobPhotoTx(
  tx: ScopedTx,
  input: InsertPhotoInput,
  refuse: (f: Failure) => never,
  now: Date,
): Promise<InsertedPhoto> {
  if (input.uploadId) {
    const marked = await tx.mediaUpload.updateMany({
      where: { id: input.uploadId, usedAt: null },
      data: { usedAt: now },
    });
    if (marked.count !== 1) refuse(usedFailure());
  }
  const countBefore = await tx.jobPhoto.count({ where: { jobId: input.job.id } });
  if (countBefore >= MAX_PHOTOS_PER_JOB) {
    refuse(failure(409, "PHOTO_LIMIT_REACHED", photoLimitMessage(countBefore)));
  }
  const photo = await tx.jobPhoto.create({
    data: {
      jobId: input.job.id,
      employeeId: input.actor.userId,
      url: input.url,
      caption: input.caption,
      kind: input.kind,
    },
  });
  if (input.uploadId) {
    await tx.mediaUpload.updateMany({ where: { id: input.uploadId }, data: { photoId: photo.id } });
  }
  return { photo, countBefore };
}

/** The same, in its own transaction. */
export async function insertJobPhoto(input: InsertPhotoInput, now: Date): Promise<Result<InsertedPhoto>> {
  return withJobLocked(input.job.id, input.actor.organizationId, (tx, refuse) =>
    insertJobPhotoTx(tx, input, refuse, now),
  );
}

/**
 * "Photos added" to the office, once per job: when this was the job's first
 * photo, and never for an ISSUE photo (the report's own email says what
 * happened). The web's rule, unchanged.
 */
export function firstPhotoEffects(job: CrewJob, actor: Actor, kind: JobPhotoKind, countBefore: number): Effect[] {
  if (countBefore !== 0 || kind === "ISSUE") return [];
  return [
    effect("admin job photos email", () =>
      sendAdminJobPhotos({
        jobId: job.id,
        jobNumber: job.jobNumber,
        clientName: job.clientName,
        cleanerName: actor.name || "A cleaner",
        kindLabel: jobPhotoKindLabel(kind),
      }),
    ),
  ];
}

// ── Attaching (phone) ───────────────────────────────────────────────────────

export type JobPhotoView = JobPhotosResponse["items"][number];

function photoView(
  p: { id: string; kind: string; url: string; caption: string | null; createdAt: Date },
  actor: Actor,
): JobPhotoView {
  return {
    id: p.id,
    kind: p.kind as JobPhotoView["kind"],
    url: p.url,
    thumbnailUrl: thumbnailUrl(p.url),
    caption: p.caption,
    takenAt: p.createdAt.toISOString(),
    takenBy: firstName(actor.name),
    mine: true,
    canDelete: true,
  };
}

export async function attachUploadedPhoto(
  actor: Actor,
  input: { orgSlug: string; jobId: string; key: string; phase: "BEFORE" | "AFTER"; now: Date },
): Promise<Result<JobPhotoView>> {
  const { job } = await jobForCrew(actor, input.jobId, "phone");
  if (!job) return notFound("This job isn't available.");

  // Cheap refusals first, so a doomed attach never costs an Admin API call.
  if (photoSwitchBlocks(actor, job, input.phase)) return failure(409, "PHOTOS_OFF", PHOTOS_OFF_MESSAGE);

  const verified = await verifyUploadedKey(actor, { orgSlug: input.orgSlug, jobId: job.id, key: input.key });
  if (!verified.ok) return verified;

  const inserted = await insertJobPhoto(
    {
      job,
      actor,
      url: verified.value.asset.secureUrl,
      caption: null,
      kind: input.phase,
      uploadId: verified.value.uploadId,
    },
    input.now,
  );
  if (!inserted.ok) return inserted;

  return ok(
    photoView(inserted.value.photo, actor),
    firstPhotoEffects(job, actor, input.phase, inserted.value.countBefore),
  );
}

// ── Deleting (both doors) ───────────────────────────────────────────────────

/**
 * Delete a photo and its Cloudinary asset. The web's rule: an owner or admin
 * any photo, anyone else only their own (a client's booking photo has no
 * uploader and is admin-only). The phone adds: the photo must be on `jobId`,
 * the caller must be on that job, and everything else is 404.
 */
export async function deleteJobPhotoFor(
  actor: Actor,
  input: { photoId: string; door: Door; jobId?: string },
): Promise<Result<{ id: string; jobId: string }>> {
  if (input.door === "phone") {
    if (!input.jobId) return notFound();
    const { job } = await jobForCrew(actor, input.jobId, "phone");
    if (!job) return notFound("This photo isn't available.");
  }

  const photo = await db.jobPhoto.findUnique({
    where: { id: input.photoId },
    select: { id: true, jobId: true, employeeId: true, url: true },
  });
  if (!photo) return failure(404, "NOT_FOUND", "Photo not found");
  if (input.jobId !== undefined && photo.jobId !== input.jobId) return failure(404, "NOT_FOUND", "Photo not found");

  const isOwner = !!photo.employeeId && photo.employeeId === actor.userId;
  const allowed = input.door === "phone" ? isOwner : isOfficeAdmin(actor) || isOwner;
  if (!allowed) {
    // The web says so; the phone gets the same 404 as any id that isn't its.
    return input.door === "phone"
      ? failure(404, "NOT_FOUND", "Photo not found")
      : failure(403, "FORBIDDEN", "You can only delete your own photos");
  }

  // Conditional on the same facts just read, so two deletes remove one row and
  // the second is a 404.
  const removed = await db.jobPhoto.deleteMany({
    where: {
      id: photo.id,
      jobId: photo.jobId,
      ...(input.door === "phone" ? { employeeId: actor.userId } : {}),
    },
  });
  if (removed.count !== 1) return failure(404, "NOT_FOUND", "Photo not found");

  const publicId = publicIdFromUrl(photo.url);
  const effects: Effect[] = [];
  if (publicId) {
    const store = mediaStore();
    effects.push(
      effect("job photo asset destroy", async () => {
        if (store.configured()) await store.destroy(publicId);
      }),
    );
  }
  return ok({ id: photo.id, jobId: photo.jobId }, effects);
}

// The job photo policy (awer_fixes.pdf item 21; surfaced by awerfixes.pdf item
// 5, round 3).
//
// PURE — no DB imports.
//
// READ THIS BEFORE ADDING A "REQUIRED PHOTOS" FEATURE: there still isn't one.
// No per-job photo COUNT is ever demanded of a cleaner. The only photo rule the
// system has is the per-job after-photo permission below — an opt-OUT an admin
// sets on a specific job. That is what the cleaner's job-scope card reports,
// and the wording is deliberately "expectation", not "requirement".
//
// What DID change (new photo/address fixes, item 1): a photo is now FILED under
// a type — before / after / issue / general — via `JobPhoto.kind`, and the
// per-job cap moved from 20 to `MAX_PHOTOS_PER_JOB` below. Filing a photo is
// not requiring one; nothing here refuses a job for missing a BEFORE.
//
// The predicate was previously written out by hand in four places
// (uploadJobPhoto, the cleaner job page twice, the admin job detail view). Four
// copies of a boolean is three chances for them to disagree about whether a
// cleaner may upload.

export interface AfterPhotoPolicySource {
  /** Opt-out flag: false = an admin turned after-photos off for this job. */
  afterPhotoConsent: boolean;
  /** Set when an admin explicitly re-allowed them after turning them off. */
  afterPhotoOverrideAt: Date | string | null;
}

/** True when this job accepts after-photos. Allowed by default. */
export function afterPhotosAllowed(job: AfterPhotoPolicySource): boolean {
  return job.afterPhotoConsent || job.afterPhotoOverrideAt !== null;
}

/**
 * The one-line photo expectation shown on the cleaner's job-scope card.
 * Before-photos are always welcome; only after-photos can be switched off.
 */
export function photoExpectationLine(job: AfterPhotoPolicySource): string {
  return afterPhotosAllowed(job)
    ? "Before and after photos — both welcome on this job."
    : "Before photos only — an admin turned after-photos off for this job.";
}

// ── The per-job photo cap (item 1) ──────────────────────────────────────────
//
// Was 20, hardcoded in two files that had to agree by hand — the server action
// and the cleaner's upload widget. The handoff: "Remove the current 20-picture
// limit… cleaners should be able to upload as many photos as needed… if a
// technical limit is needed, it should be much higher and clearly shown before
// upload."
//
// So: one constant, an order of magnitude higher, and it is printed in the
// upload widget before a cleaner picks a single file rather than thrown at them
// after they have queued 40.
//
// Why a number at all, when the ask starts with "remove the limit": an unbounded
// count is not free. Every photo is a Cloudinary upload, a row, and a thumbnail
// the job page and the calendar drawer both render eagerly; a phone that dumps
// its entire camera roll into one job would take the job page down for the
// office, and there would be no message explaining why. 200 is far past what
// documenting a clean takes (a large post-construction job runs 40–60) while
// still being a number a page can render. It is one edit, in one file, if a job
// ever legitimately needs more.
export const MAX_PHOTOS_PER_JOB = 200;

/** How a job photo is filed. Mirrors `enum JobPhotoKind` in schema.prisma. */
export type JobPhotoKind = "BEFORE" | "AFTER" | "ISSUE" | "GENERAL";

/**
 * Display order, which is also chronological order on a real job: what it
 * looked like, what it looks like now, what went wrong, everything else.
 */
export const JOB_PHOTO_KINDS: readonly JobPhotoKind[] = [
  "BEFORE",
  "AFTER",
  "ISSUE",
  "GENERAL",
] as const;

/**
 * The value a photo gets when nobody said. Every row that predates the column
 * is GENERAL, and so is every upload from a surface that does not offer the
 * choice — the customer's booking photos, for one.
 */
export const DEFAULT_JOB_PHOTO_KIND: JobPhotoKind = "GENERAL";

export const JOB_PHOTO_KIND_LABEL: Record<JobPhotoKind, string> = {
  BEFORE: "Before",
  AFTER: "After",
  ISSUE: "Issue",
  GENERAL: "Job photo",
};

/** One line of plain English per option, for the picker on the upload widget. */
export const JOB_PHOTO_KIND_HINT: Record<JobPhotoKind, string> = {
  BEFORE: "The space as you found it, before you started.",
  AFTER: "The finished result, at hand-off.",
  ISSUE: "Damage, a blocked room, anything the office needs to see.",
  GENERAL: "Anything else worth recording on this job.",
};

export function isJobPhotoKind(v: unknown): v is JobPhotoKind {
  return (
    v === "BEFORE" || v === "AFTER" || v === "ISSUE" || v === "GENERAL"
  );
}

/**
 * Parse a submitted value into a column value.
 *
 * Falls back to GENERAL rather than to null or an error: unlike `propertyType`,
 * where "not recorded" is a meaningful third state, `kind` is NOT NULL and
 * GENERAL *is* its "not recorded". An upload must never fail because a select
 * arrived empty — the photo is the point, the filing is the metadata.
 */
export function parseJobPhotoKind(v: unknown): JobPhotoKind {
  if (typeof v !== "string") return DEFAULT_JOB_PHOTO_KIND;
  const up = v.trim().toUpperCase();
  return isJobPhotoKind(up) ? up : DEFAULT_JOB_PHOTO_KIND;
}

/** Human label for a stored value, safe on a row read before the column existed. */
export function jobPhotoKindLabel(v: unknown): string {
  return JOB_PHOTO_KIND_LABEL[parseJobPhotoKind(v)];
}

/**
 * Split a list of photos into its four buckets, in `JOB_PHOTO_KINDS` order,
 * dropping the empty ones. Every gallery groups the same way from this, so a
 * job cannot show "Before" on one screen and "before photos" on another.
 */
export function groupPhotosByKind<T extends { kind?: unknown }>(
  photos: readonly T[]
): { kind: JobPhotoKind; label: string; photos: T[] }[] {
  return JOB_PHOTO_KINDS.map((kind) => ({
    kind,
    label: JOB_PHOTO_KIND_LABEL[kind],
    photos: photos.filter((p) => parseJobPhotoKind(p.kind) === kind),
  })).filter((g) => g.photos.length > 0);
}

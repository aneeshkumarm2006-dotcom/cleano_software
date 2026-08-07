// The job photo policy (awer_fixes.pdf item 21; surfaced by awerfixes.pdf item
// 5, round 3).
//
// PURE — no DB imports.
//
// READ THIS BEFORE ADDING A "REQUIRED PHOTOS" FEATURE: there isn't one, and
// nothing here is it. `JobPhoto` carries no before/after discriminator and no
// per-job photo count is ever demanded. The ONLY photo rule the system has is
// the per-job after-photo permission below — an opt-OUT an admin sets on a
// specific job. That is what the cleaner's job-scope card reports, and the
// wording is deliberately "expectation", not "requirement".
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

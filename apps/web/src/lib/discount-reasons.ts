// Discount reasons (awer_fixes.pdf item 29).
//
// The spec says an admin should "select OR enter" a reason, so the stored value
// is a plain string rather than an enum: the presets below cover the common
// cases, and anything else can be typed. That also means a preset can be
// renamed later without a data migration.
//
// PURE — no DB imports — so the job modal, the job detail and reporting all
// label a stored reason the same way.

/** The preset reasons the spec names, in the order it lists them. */
export const DISCOUNT_REASONS = [
  "Marketing",
  "Recurring Discount",
  "Complaint",
  "Courtesy",
  "Referral",
  "Manual Adjustment",
  "Other",
] as const;

export type DiscountReason = (typeof DISCOUNT_REASONS)[number];

/** Shown wherever a discount exists but no reason was recorded. */
export const NO_REASON_LABEL = "No reason assigned";

/**
 * Reasons the SYSTEM applies on the customer's behalf, so reporting shows why
 * an automatic discount exists instead of a blank. These are exact preset
 * strings on purpose — they must group with the manually-chosen ones.
 */
export const AUTO_REASON = {
  RECURRING: "Recurring Discount" as const,
  REFERRAL: "Referral" as const,
} satisfies Record<string, DiscountReason>;

export function isPresetReason(v: unknown): v is DiscountReason {
  return (
    typeof v === "string" && (DISCOUNT_REASONS as readonly string[]).includes(v)
  );
}

/** Trim and cap a typed reason; empty becomes null so it reads as "not set". */
export function normalizeDiscountReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, 120);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * What to render for a job's discount reason.
 *
 * Returns null when there is no discount at all — a job with no discount should
 * show nothing, not "No reason assigned", which would imply one is missing.
 */
export function discountReasonLabel(job: {
  discountAmount?: number | null;
  discountReason?: string | null;
}): string | null {
  const hasDiscount = (job.discountAmount ?? 0) > 0;
  if (!hasDiscount) return null;
  return normalizeDiscountReason(job.discountReason) ?? NO_REASON_LABEL;
}

/** True when a discount exists but nobody recorded why. */
export function isMissingReason(job: {
  discountAmount?: number | null;
  discountReason?: string | null;
}): boolean {
  return (
    (job.discountAmount ?? 0) > 0 &&
    normalizeDiscountReason(job.discountReason) === null
  );
}

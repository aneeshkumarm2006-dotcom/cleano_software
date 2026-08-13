// Calendar priority labels — the "R" (Routine) / "I" (Important) badges shown
// in the top-left of a booking on the calendar so operations managers can spot
// important bookings at a glance.
//
// IMPORTANT: Job.jobType is stored in several formats across the app —
//   • admin modal short codes:  "R", "DEEP", "MOVE_IN", "C", "PC", "F", …
//   • admin /jobs/new full text: "R - Residential", "C - Commercial", …
//   • customer booking flow:     "STANDARD", "MOVE_IN_OUT", "POST_CONSTRUCTION"
// So we normalise any of these to a canonical service category, then map the
// category -> label. The mapping is admin-editable via the
// `calendar.jobTypeLabels` setting; a manager can override a single booking from
// the job detail page (Job.priorityLabel).
//
// This module is intentionally free of server-only imports so both the settings
// registry and client components can read it.

export type PriorityLabel = "ROUTINE" | "IMPORTANT" | "NONE";

export const PRIORITY_LABELS: PriorityLabel[] = ["ROUTINE", "IMPORTANT", "NONE"];

/** Canonical service categories the admin configures labels for. */
export interface ServiceCategory {
  key: string;
  label: string;
}

export const SERVICE_CATEGORIES: ServiceCategory[] = [
  { key: "RESIDENTIAL", label: "Residential / General" },
  { key: "DEEP", label: "Deep Cleaning" },
  { key: "MOVE_IN", label: "Move-in Cleaning" },
  { key: "MOVE_OUT", label: "Move-out Cleaning" },
  { key: "MOVE_IN_OUT", label: "Move-in / Move-out" },
  { key: "POST_CONSTRUCTION", label: "Post Construction" },
  { key: "COMMERCIAL", label: "Commercial" },
  { key: "AIRBNB", label: "Airbnb Cleaning" },
  { key: "FOLLOW_UP", label: "Follow-up" },
];

export const SERVICE_CATEGORY_KEYS = SERVICE_CATEGORIES.map((c) => c.key);

/** Default category -> label mapping. This is the `calendar.jobTypeLabels`
 *  default: general/move/deep/post-construction = Routine, commercial =
 *  Important; Airbnb & Follow-up unlabelled until an admin sets them. */
export const DEFAULT_JOB_TYPE_LABELS: Record<string, PriorityLabel> = {
  RESIDENTIAL: "ROUTINE",
  DEEP: "ROUTINE",
  MOVE_IN: "ROUTINE",
  MOVE_OUT: "ROUTINE",
  MOVE_IN_OUT: "ROUTINE",
  POST_CONSTRUCTION: "ROUTINE",
  COMMERCIAL: "IMPORTANT",
  AIRBNB: "NONE",
  FOLLOW_UP: "NONE",
};

// All the raw stored codes we know how to fold into a canonical category.
//
// Exported because service-category PERMISSIONS (awerfixes.pdf item 3) are only
// as good as this map: a jobType that doesn't fold has no category to gate on.
// The Stage-0 probe found 97 of 221 live jobs (44%) sitting on BookingKoala free
// text that returned null here — "House", "Apartment", "Move In & Out",
// "Deep Cleaning", "Detached Home (2000+ sqft)", "Post Construction Cleaning".
// Those entries are now present, and the verify script asserts the live distinct
// list against this map so the next import format that drifts is caught.
export const CATEGORY_ALIASES: Record<string, string> = {
  R: "RESIDENTIAL",
  RESIDENTIAL: "RESIDENTIAL",
  STANDARD: "RESIDENTIAL",
  GENERAL: "RESIDENTIAL",
  // BookingKoala property-type names — all ordinary homes, all residential.
  HOUSE: "RESIDENTIAL",
  APARTMENT: "RESIDENTIAL",
  CONDO: "RESIDENTIAL",
  TOWNHOUSE: "RESIDENTIAL",
  DETACHED_HOME: "RESIDENTIAL",
  DEEP: "DEEP",
  MOVE_IN: "MOVE_IN",
  MOVEIN: "MOVE_IN",
  MOVE_OUT: "MOVE_OUT",
  MOVEOUT: "MOVE_OUT",
  MOVE_IN_OUT: "MOVE_IN_OUT",
  MOVEINOUT: "MOVE_IN_OUT",
  // "Move In & Out" — the ampersand survives the underscore rewrite below.
  "MOVE_IN_&_OUT": "MOVE_IN_OUT",
  MOVE_IN_AND_OUT: "MOVE_IN_OUT",
  PC: "POST_CONSTRUCTION",
  POST_CONSTRUCTION: "POST_CONSTRUCTION",
  POSTCONSTRUCTION: "POST_CONSTRUCTION",
  C: "COMMERCIAL",
  COMMERCIAL: "COMMERCIAL",
  AIRBNB: "AIRBNB",
  F: "FOLLOW_UP",
  FOLLOW_UP: "FOLLOW_UP",
  FOLLOWUP: "FOLLOW_UP",
};

// ── Industry (the Analytics filter dimension) ────────────────────────────────
//
// The client asked to "sort by industry (residential, commercial, airbnb and
// ALL)" — three positions, but nine service categories exist above. Deep,
// move-in/out, post-construction and follow-up are services *sold into* an
// industry, not industries, so they fold onto Residential. This map is the ONE
// source of truth for that fold; it lives here, beside CATEGORY_ALIASES, so the
// category → industry rule can never drift from the raw → category rule.
//
// KEEP IN LOCKSTEP with SERVICE_CATEGORIES. A category missing from this map
// deliberately falls through to "Unspecified" rather than disappearing: the
// Analytics filter shows Unspecified as its own position, so ALL always equals
// the sum of the parts and a newly added service shows up as un-mapped instead
// of silently vanishing from every reading.

export type IndustryKey = "RESIDENTIAL" | "COMMERCIAL" | "AIRBNB";

/** Bucket for jobs whose stored jobType doesn't fold to a known category. */
export const INDUSTRY_UNSPECIFIED = "UNSPECIFIED";

/** A job always lands in exactly one of these — so ALL = Σ positions. */
export type JobIndustry = IndustryKey | typeof INDUSTRY_UNSPECIFIED;

/** The filter control's positions. */
export type IndustryFilter = JobIndustry | "ALL";

export const INDUSTRY_BY_CATEGORY: Record<string, IndustryKey> = {
  RESIDENTIAL: "RESIDENTIAL",
  DEEP: "RESIDENTIAL",
  MOVE_IN: "RESIDENTIAL",
  MOVE_OUT: "RESIDENTIAL",
  MOVE_IN_OUT: "RESIDENTIAL",
  POST_CONSTRUCTION: "RESIDENTIAL",
  FOLLOW_UP: "RESIDENTIAL",
  COMMERCIAL: "COMMERCIAL",
  AIRBNB: "AIRBNB",
};

export const INDUSTRIES: Array<{ key: IndustryKey; label: string }> = [
  { key: "RESIDENTIAL", label: "Residential" },
  { key: "COMMERCIAL", label: "Commercial" },
  { key: "AIRBNB", label: "Airbnb" },
];

export const INDUSTRY_LABELS: Record<IndustryFilter, string> = {
  ALL: "All",
  RESIDENTIAL: "Residential",
  COMMERCIAL: "Commercial",
  AIRBNB: "Airbnb",
  UNSPECIFIED: "Unspecified",
};

/** Industry for a canonical category key, or null if the map doesn't cover it. */
export function industryForCategory(
  category: string | null | undefined
): IndustryKey | null {
  if (!category) return null;
  return INDUSTRY_BY_CATEGORY[category] ?? null;
}

/**
 * Total function: every job gets exactly one industry, "UNSPECIFIED" included.
 * That totality is what makes ALL equal the sum of the filter positions.
 */
export function jobIndustry(raw: string | null | undefined): JobIndustry {
  return industryForCategory(normalizeJobType(raw)) ?? INDUSTRY_UNSPECIFIED;
}

export function isIndustryFilter(v: unknown): v is IndustryFilter {
  return (
    v === "ALL" ||
    v === "UNSPECIFIED" ||
    v === "RESIDENTIAL" ||
    v === "COMMERCIAL" ||
    v === "AIRBNB"
  );
}

/** Parse a URL value into a filter position; anything unrecognised → ALL. */
export function parseIndustryFilter(v: unknown): IndustryFilter {
  if (typeof v !== "string") return "ALL";
  const up = v.trim().toUpperCase();
  return isIndustryFilter(up) ? up : "ALL";
}

/** Does this job's stored jobType belong to the selected filter position? */
export function jobMatchesIndustry(
  raw: string | null | undefined,
  filter: IndustryFilter
): boolean {
  if (filter === "ALL") return true;
  return jobIndustry(raw) === filter;
}

/** Fold any stored jobType representation into a canonical category key. */
export function normalizeJobType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw
    .split(" - ")[0] // "R - Residential" -> "R"
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_"); // "POST CONSTRUCTION" -> "POST_CONSTRUCTION"
  const direct = CATEGORY_ALIASES[code];
  if (direct) return direct;

  // Second pass for the descriptive names imports carry. Strip a trailing
  // size/qualifier parenthetical and a trailing "CLEANING", then look up again:
  //   "Detached Home (2000+ sqft)"   -> DETACHED_HOME    -> RESIDENTIAL
  //   "Deep Cleaning"                -> DEEP             -> DEEP
  //   "Post Construction Cleaning"   -> POST_CONSTRUCTION-> POST_CONSTRUCTION
  // Listing every such string as its own alias would mean chasing every new
  // wording; trimming the decoration folds a whole family at once.
  const trimmed = code
    .replace(/_*\([^)]*\)\s*$/, "") // drop "(2000+ SQFT)"
    .replace(/_CLEANING$/, "")
    .replace(/_+$/, "");
  if (trimmed && trimmed !== code) return CATEGORY_ALIASES[trimmed] ?? null;
  return null;
}

/** Concise human labels for job-type pills / descriptions (the settings UI
 *  uses the longer SERVICE_CATEGORIES labels). */
const JOB_TYPE_PRETTY_LABELS: Record<string, string> = {
  RESIDENTIAL: "Residential",
  DEEP: "Deep Cleaning",
  MOVE_IN: "Move-in",
  MOVE_OUT: "Move-out",
  MOVE_IN_OUT: "Move-in / Move-out",
  POST_CONSTRUCTION: "Post-Construction",
  COMMERCIAL: "Commercial",
  AIRBNB: "Airbnb",
  FOLLOW_UP: "Follow-up",
};

/**
 * Human label for any stored jobType representation ("MOVE_IN_OUT",
 * "R - Residential", "R", …). Falls back to a title-cased cleanup of the raw
 * value so raw enum text never leaks into the UI.
 */
export function jobTypeLabel(
  raw: string | null | undefined,
  /**
   * Optional category -> admin label map from the Settings service catalog
   * (item 20). When supplied, an admin's own service name wins, so renaming a
   * service in Settings renames it everywhere it appears. Omitted callers keep
   * the built-in labels, so this stays backward compatible.
   */
  adminLabels?: Record<string, string>
): string {
  if (!raw) return "";
  const category = normalizeJobType(raw);
  if (category) {
    // A legacy MOVE_IN / MOVE_OUT job folds onto the combined service when the
    // business now offers only the combined one.
    const adminLabel =
      adminLabels?.[category] ??
      ((category === "MOVE_IN" || category === "MOVE_OUT")
        ? adminLabels?.MOVE_IN_OUT
        : undefined);
    return (
      adminLabel ??
      JOB_TYPE_PRETTY_LABELS[category] ??
      SERVICE_CATEGORIES.find((c) => c.key === category)?.label ??
      category
    );
  }
  return raw
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/(^|\s|-)\w/g, (ch) => ch.toUpperCase())
    .trim();
}

export function isPriorityLabel(v: unknown): v is PriorityLabel {
  return v === "ROUTINE" || v === "IMPORTANT" || v === "NONE";
}

/**
 * Effective label for a booking: an explicit per-job override wins, otherwise
 * the admin-configured mapping for the job's (normalised) service category.
 */
export function resolvePriorityLabel(
  jobType: string | null | undefined,
  override: string | null | undefined,
  config: Record<string, PriorityLabel>
): PriorityLabel {
  if (isPriorityLabel(override)) return override;
  const category = normalizeJobType(jobType);
  if (!category) return "NONE";
  return config[category] ?? DEFAULT_JOB_TYPE_LABELS[category] ?? "NONE";
}

/** Normalise a raw stored/incoming mapping to a full, valid category map. */
export function normaliseLabelMap(v: unknown): Record<string, PriorityLabel> {
  const src =
    v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  const out: Record<string, PriorityLabel> = {};
  for (const key of SERVICE_CATEGORY_KEYS) {
    const raw = src[key];
    out[key] = isPriorityLabel(raw) ? raw : DEFAULT_JOB_TYPE_LABELS[key] ?? "NONE";
  }
  return out;
}

/** Human label for the switch / settings dropdowns. */
export const PRIORITY_LABEL_TEXT: Record<PriorityLabel, string> = {
  ROUTINE: "Routine (R)",
  IMPORTANT: "Important (I)",
  NONE: "No label",
};

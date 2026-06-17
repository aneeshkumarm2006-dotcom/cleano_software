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
const CATEGORY_ALIASES: Record<string, string> = {
  R: "RESIDENTIAL",
  RESIDENTIAL: "RESIDENTIAL",
  STANDARD: "RESIDENTIAL",
  GENERAL: "RESIDENTIAL",
  DEEP: "DEEP",
  MOVE_IN: "MOVE_IN",
  MOVEIN: "MOVE_IN",
  MOVE_OUT: "MOVE_OUT",
  MOVEOUT: "MOVE_OUT",
  MOVE_IN_OUT: "MOVE_IN_OUT",
  MOVEINOUT: "MOVE_IN_OUT",
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

/** Fold any stored jobType representation into a canonical category key. */
export function normalizeJobType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw
    .split(" - ")[0] // "R - Residential" -> "R"
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_"); // "POST CONSTRUCTION" -> "POST_CONSTRUCTION"
  return CATEGORY_ALIASES[code] ?? null;
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

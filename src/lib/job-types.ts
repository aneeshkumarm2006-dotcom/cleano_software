// DEPRECATED — kept only so filters keep recognising the old stored values that
// still exist in historical `Job.jobType` data.
//
// THE service list now lives in Settings → Job Types and is read via
// `src/lib/service-catalog.ts` (awer_fixes.pdf item 20). Before that, this file
// was one of SIX hardcoded job-type lists, and it offered Move-in and Move-out
// as separate services even where the business sells a single combined one.
//
// Do NOT add entries here and do NOT use this for pickers — use
// `serviceOptions(await getServiceCatalog())` instead.

/**
 * Legacy `Job.jobType` strings present in historical rows. Retained so the
 * labour-cost filter can still match old data; `normalizeJobType()` maps every
 * one of them onto a canonical category for display and behaviour.
 */
export const LEGACY_JOB_TYPE_VALUES: string[] = [
  "R - Residential",
  "DEEP - Deep Cleaning",
  "MOVE_IN - Move-in Cleaning",
  "MOVE_OUT - Move-out Cleaning",
  "AIRBNB - Airbnb Cleaning",
  "C - Commercial",
  "PC - Post Construction",
  "F - Follow-up",
];

/** @deprecated Use `serviceOptions(await getServiceCatalog())` for pickers. */
export const JOB_TYPE_VALUES = LEGACY_JOB_TYPE_VALUES;

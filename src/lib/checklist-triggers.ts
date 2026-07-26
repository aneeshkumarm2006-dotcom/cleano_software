// Checklist template triggers (awer_fixes.pdf item 27).
//
// A template can be scoped to a JOB TYPE, an ADD-ON, or BOTH — the spec asks
// for all three. Two defects made that untrue:
//
//   1. Add-on matching was CASE-SENSITIVE (the Settings hint even admitted it:
//      "case-sensitive match"), so a template for "Inside Fridge" silently
//      failed on a job whose add-on was stored as "Inside fridge". Free-text
//      entry on both sides made that near-inevitable.
//
//   2. "BOTH" did not work. The matcher returned on jobType alone, so a
//      template scoped to Residential AND "Inside Fridge" attached to EVERY
//      residential job whether or not the add-on was present.
//
// PURE — no DB imports — so the Settings editor and the generator agree.

import { normalizeJobType } from "./calendar-labels";

/** Comparison key for an add-on name: case- and whitespace-insensitive. */
export function addOnKey(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export interface ChecklistTriggerTemplate {
  jobType: string | null;
  addOnName: string | null;
}

export interface ChecklistTriggerJob {
  jobType: string | null;
  addOnNames: string[];
}

/**
 * The set of template categories a job should pull in. A combined
 * MOVE_IN_OUT job legitimately wants both halves of a move.
 */
export function wantedCategoriesFor(jobType: string | null): Set<string> {
  const category = normalizeJobType(jobType);
  if (category === "MOVE_IN_OUT") {
    return new Set(["MOVE_IN_OUT", "MOVE_IN", "MOVE_OUT"]);
  }
  return new Set(category ? [category] : []);
}

/**
 * Does this template apply to this job?
 *
 *   jobType + addOnName  → BOTH must match (an add-on-scoped extra, e.g.
 *                          "fridge steps, but only on residential jobs")
 *   jobType only         → every job of that service category
 *   addOnName only       → any job carrying that add-on
 *   neither              → global, always applies
 */
export function templateMatchesJob(
  template: ChecklistTriggerTemplate,
  job: ChecklistTriggerJob
): boolean {
  const wanted = wantedCategoriesFor(job.jobType);
  const jobAddOnKeys = new Set(job.addOnNames.map(addOnKey));

  const typeMatches = template.jobType
    ? wanted.has(normalizeJobType(template.jobType) ?? "")
    : null;

  const addOnMatches = template.addOnName
    ? jobAddOnKeys.has(addOnKey(template.addOnName))
    : null;

  // BOTH scoped — require both, which is the fix for defect (2).
  if (typeMatches !== null && addOnMatches !== null) {
    return typeMatches && addOnMatches;
  }
  if (typeMatches !== null) return typeMatches;
  if (addOnMatches !== null) return addOnMatches;
  return true; // global template
}

/** Human description of a template's trigger, for the Settings list. */
export function describeTrigger(template: ChecklistTriggerTemplate): string {
  if (template.jobType && template.addOnName) {
    return `${template.jobType} + add-on "${template.addOnName}"`;
  }
  if (template.jobType) return template.jobType;
  if (template.addOnName) return `Add-on: ${template.addOnName}`;
  return "All jobs";
}

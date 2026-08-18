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

// ── Stage 10 / PDF #10: customer & contract scoping ─────────────────────────
//
// `templateMatchesJob` above answers "does this template's SERVICE trigger fire
// on this job". Everything below answers the second, independent question the
// PDF adds: "is this template even FOR this customer" — and, when several
// templates could apply, which one wins.
//
// The two are deliberately kept apart. A template can be scoped to a client AND
// to a job type ("Mckiernan, but only their deep cleans"), so the service
// trigger still has to run inside the customer tier; folding customer scoping
// into `templateMatchesJob` would have made that combination inexpressible and
// would have changed the meaning of every existing call site.

/** The scope columns added in Stage 10. */
export interface ChecklistScopedTemplate extends ChecklistTriggerTemplate {
  id: string;
  clientId: string | null;
  clientAddressId: string | null;
}

/** What the resolver needs to know about the job, beyond its service trigger. */
export interface ChecklistScopedJob extends ChecklistTriggerJob {
  clientId: string | null;
  clientAddressId: string | null;
  /** `Job.checklistTemplateId` — the per-job pin. */
  checklistTemplateId: string | null;
}

/**
 * Which tier of the precedence produced the resolved set. Reported so the admin
 * panel can say WHY a job has the checklist it has, instead of showing a list
 * with no provenance.
 */
export type ChecklistResolutionTier =
  /** `Job.checklistTemplateId` — an admin pinned this one job. */
  | "JOB"
  /** A template scoped to this job's saved address. */
  | "ADDRESS"
  /** A template scoped to this job's client, any location. */
  | "CLIENT"
  /** The ordinary jobType / add-on matching that predates Stage 10. */
  | "DEFAULT"
  /** Nothing matches — the job gets no checklist at all. */
  | "NONE";

export interface ChecklistResolution<T> {
  tier: ChecklistResolutionTier;
  /** Templates that produce this job's checklist, in template order. */
  templates: T[];
  /**
   * True when the job pins a template that is not in the candidate set — it was
   * deactivated, or deleted between the pin and this read. The job falls back
   * to automatic resolution (the tier reported is the fallback's), and the
   * admin panel says so rather than letting a checklist change silently.
   */
  pinnedUnavailable: boolean;
}

/**
 * Is this template scoped to this job's CUSTOMER?
 *
 * Address-scoped is the narrow case and is checked first: such a template is
 * always stored with its `clientId` too (both server actions enforce it), so
 * matching on the address alone is sufficient and matching on the client alone
 * would wrongly fire it at the customer's other locations.
 */
export function templateScopeMatchesJob(
  template: Pick<ChecklistScopedTemplate, "clientId" | "clientAddressId">,
  job: Pick<ChecklistScopedJob, "clientId" | "clientAddressId">
): boolean {
  if (template.clientAddressId) {
    return !!job.clientAddressId && job.clientAddressId === template.clientAddressId;
  }
  if (template.clientId) {
    return !!job.clientId && job.clientId === template.clientId;
  }
  return true; // not customer-scoped — falls to the DEFAULT tier
}

/**
 * THE precedence. One function, used by the cleaner's job page, the pre-claim
 * preview and the admin panel, so all three can never disagree about which
 * checklist a job has.
 *
 *   job pin → address-scoped → client-scoped → jobType/add-on default → none
 *
 * The tiers REPLACE each other, they do not stack. That is the PDF's wording —
 * "custom checklist should override the default service-type checklist" — and
 * it is the only reading that makes the Mckiernan example work: a strict
 * restaurant list is strict precisely because the generic commercial items are
 * not also bolted on.
 *
 * Within a tier every matching template still contributes, which is how the
 * pre-Stage-10 behaviour (a global list + a jobType list + an add-on list, all
 * three concatenated) survives untouched for every job with no customer link.
 *
 * `candidates` must already be filtered to ACTIVE templates — deactivating a
 * template is how one is retired, and that has to hold for a pinned one too.
 * PURE: no DB, no framework.
 */
export function resolveChecklistTemplates<T extends ChecklistScopedTemplate>(
  candidates: T[],
  job: ChecklistScopedJob
): ChecklistResolution<T> {
  let pinnedUnavailable = false;

  if (job.checklistTemplateId) {
    const pinned = candidates.find((t) => t.id === job.checklistTemplateId);
    if (pinned) {
      // The pin beats the template's own jobType/add-on trigger as well as the
      // customer tiers. An admin who picked a specific list for a specific job
      // means it; re-testing the trigger would let a "Residential" template
      // silently do nothing on the commercial job it was deliberately pinned to.
      return { tier: "JOB", templates: [pinned], pinnedUnavailable: false };
    }
    pinnedUnavailable = true;
  }

  const matching = candidates.filter(
    (t) => templateScopeMatchesJob(t, job) && templateMatchesJob(t, job)
  );

  const addressScoped = matching.filter((t) => t.clientAddressId);
  if (addressScoped.length > 0) {
    return { tier: "ADDRESS", templates: addressScoped, pinnedUnavailable };
  }

  const clientScoped = matching.filter((t) => !t.clientAddressId && t.clientId);
  if (clientScoped.length > 0) {
    return { tier: "CLIENT", templates: clientScoped, pinnedUnavailable };
  }

  const generic = matching.filter((t) => !t.clientId && !t.clientAddressId);
  return {
    tier: generic.length > 0 ? "DEFAULT" : "NONE",
    templates: generic,
    pinnedUnavailable,
  };
}

/** One line of plain English per tier, for the admin job panel. */
export const CHECKLIST_TIER_HINT: Record<ChecklistResolutionTier, string> = {
  JOB: "Pinned to this job by an admin — overrides every automatic rule.",
  ADDRESS: "Custom checklist for this customer at this location.",
  CLIENT: "Custom checklist for this customer, at all of their locations.",
  DEFAULT: "The standard checklist for this service type and its add-ons.",
  NONE: "No checklist template matches this job.",
};

/** Short badge label per tier. */
export const CHECKLIST_TIER_LABEL: Record<ChecklistResolutionTier, string> = {
  JOB: "Pinned to this job",
  ADDRESS: "Location checklist",
  CLIENT: "Customer checklist",
  DEFAULT: "Service-type default",
  NONE: "None",
};

/**
 * Human description of a template's CUSTOMER scope, for the Settings list chip
 * and the job form's picker — "Mckiernan — all locations", "Mckiernan — 12 Main
 * St". Returns null for a template that is not customer-scoped, so callers have
 * to decide out loud whether to render a chip at all.
 */
export function describeScope(template: {
  clientId: string | null;
  clientAddressId: string | null;
  clientName?: string | null;
  addressLabel?: string | null;
}): string | null {
  if (!template.clientId && !template.clientAddressId) return null;
  const who = template.clientName?.trim() || "Customer";
  if (template.clientAddressId) {
    const where = template.addressLabel?.trim();
    return where ? `${who} — ${where}` : `${who} — one location`;
  }
  return `${who} — all locations`;
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

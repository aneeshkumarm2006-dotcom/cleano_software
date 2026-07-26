// THE service list (awer_fixes.pdf item 20).
//
// Before this module there were SIX hardcoded job-type lists — job-types.ts,
// JobTypeSelector, JobModal, the admin Jobs filter, the cleaner Jobs filter and
// the checklist-template editor — and Settings → Job Types wrote a
// `jobTypes.list` AppSetting that **nothing read at all**. An admin could
// rename or remove a service and absolutely nothing changed in the product.
//
// Two of those lists didn't even agree on what gets STORED: the full-page form
// wrote "MOVE_IN - Move-in Cleaning" while the modal wrote "MOVE_IN".
//
// Model
// -----
//   • `category` is the CANONICAL KEY (RESIDENTIAL, MOVE_IN_OUT, …). It drives
//     behaviour: pricing, frequency discounts, sqft pricing, checklists,
//     calendar labels. It is what gets written to `Job.jobType`.
//   • `name` is the ADMIN-EDITABLE LABEL. Renaming it in Settings changes the
//     name everywhere, precisely because jobs store the category, not the label.
//
// PURE — no DB imports — so client pickers and server actions share it.

import { SERVICE_CATEGORIES, normalizeJobType } from "./calendar-labels";

export const SERVICE_CATALOG_KEY = "jobTypes.list";

export interface ServiceCatalogEntry {
  id: string;
  /** Admin-editable display name. */
  name: string;
  /** Canonical category key — drives all behaviour. */
  category: string;
  isActive: boolean;
}

/**
 * Shipped default catalog. Deliberately offers the COMBINED "Move-in /
 * Move-out" rather than two separate services, matching both the Settings tab's
 * own defaults and the spec's worked example.
 */
export const DEFAULT_SERVICE_CATALOG: ServiceCatalogEntry[] = [
  { id: "residential", name: "Residential / General", category: "RESIDENTIAL", isActive: true },
  { id: "deep", name: "Deep Cleaning", category: "DEEP", isActive: true },
  { id: "move", name: "Move-in / Move-out", category: "MOVE_IN_OUT", isActive: true },
  { id: "post", name: "Post-Construction", category: "POST_CONSTRUCTION", isActive: true },
  { id: "airbnb", name: "Airbnb Cleaning", category: "AIRBNB", isActive: true },
  { id: "commercial", name: "Commercial", category: "COMMERCIAL", isActive: true },
  { id: "followup", name: "Follow-up", category: "FOLLOW_UP", isActive: true },
];

const VALID_CATEGORIES = new Set(SERVICE_CATEGORIES.map((c) => c.key));

/**
 * Best-effort category for a legacy Settings row that only has a free-text
 * name. The original tab stored `{id, name, isActive}` with no category, so
 * existing saved lists ("Standard Cleaning", "Move-In/Out", …) must still map
 * onto real behaviour rather than silently becoming uncategorised.
 */
export function inferCategoryFromName(name: string): string | null {
  const direct = normalizeJobType(name);
  if (direct) return direct;

  const n = name.toLowerCase();
  // Order matters: "move-in/out" must beat the bare "move in" check.
  if (/(move).*(out)|move-?in ?\/ ?-?out|move in\/out/.test(n)) return "MOVE_IN_OUT";
  if (n.includes("move") && n.includes("in")) return "MOVE_IN";
  if (n.includes("move") && n.includes("out")) return "MOVE_OUT";
  if (n.includes("deep")) return "DEEP";
  if (n.includes("post") || n.includes("construction")) return "POST_CONSTRUCTION";
  if (n.includes("airbnb") || n.includes("air bnb")) return "AIRBNB";
  if (n.includes("commercial") || n.includes("office")) return "COMMERCIAL";
  if (n.includes("follow")) return "FOLLOW_UP";
  if (n.includes("standard") || n.includes("regular") || n.includes("general") || n.includes("residential")) {
    return "RESIDENTIAL";
  }
  return null;
}

/**
 * Merge whatever is stored in `jobTypes.list` with the defaults.
 *
 * Handles three shapes: absent (use defaults), the legacy `{id,name,isActive}`
 * rows (infer the category), and the current `{id,name,category,isActive}`.
 * A row whose category can't be resolved is dropped rather than allowed to
 * produce jobs the pricing engine can't reason about.
 */
export function normalizeServiceCatalog(raw: unknown): ServiceCatalogEntry[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_SERVICE_CATALOG;

  const out: ServiceCatalogEntry[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name) continue;

    const explicit =
      typeof r.category === "string" && VALID_CATEGORIES.has(r.category)
        ? r.category
        : null;
    const category = explicit ?? inferCategoryFromName(name);
    if (!category) continue;

    // One entry per category — two rows mapping to the same category would put
    // duplicate options in every picker, which is exactly what this item removes.
    if (seen.has(category)) continue;
    seen.add(category);

    out.push({
      id: typeof r.id === "string" && r.id ? r.id : category.toLowerCase(),
      name,
      category,
      isActive: r.isActive !== false,
    });
  }

  return out.length > 0 ? out : DEFAULT_SERVICE_CATALOG;
}

/** Services offered in pickers — active only, in configured order. */
export function activeServices(
  catalog: ServiceCatalogEntry[]
): ServiceCatalogEntry[] {
  return catalog.filter((s) => s.isActive);
}

/** category -> admin label, for rendering any stored jobType. */
export function serviceLabelMap(
  catalog: ServiceCatalogEntry[]
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const s of catalog) map[s.category] = s.name;
  return map;
}

/**
 * Picker options. Values are CANONICAL CATEGORY KEYS, so a later rename in
 * Settings changes the label without orphaning existing jobs.
 */
export function serviceOptions(
  catalog: ServiceCatalogEntry[],
  opts: { includeBlank?: string; includeAll?: string } = {}
): { value: string; label: string }[] {
  const options = activeServices(catalog).map((s) => ({
    value: s.category,
    label: s.name,
  }));
  if (opts.includeAll) return [{ value: "all", label: opts.includeAll }, ...options];
  if (opts.includeBlank !== undefined) {
    return [{ value: "", label: opts.includeBlank }, ...options];
  }
  return options;
}

/**
 * Label for any stored jobType value — current keys, legacy admin strings
 * ("MOVE_IN - Move-in Cleaning") and booking-flow values ("STANDARD") alike.
 * This is how "existing jobs using old service labels are mapped to the correct
 * current service type" (spec, item 20) without touching stored data.
 *
 * When the catalog offers the COMBINED move service but a legacy job is stored
 * as MOVE_IN / MOVE_OUT, it folds onto the combined entry so the job doesn't
 * display a service the business no longer offers.
 */
export function resolveServiceLabel(
  rawJobType: string | null | undefined,
  labels: Record<string, string>,
  fallback: (raw: string | null | undefined) => string
): string {
  if (!rawJobType) return "";
  const category = normalizeJobType(rawJobType);
  if (!category) return fallback(rawJobType);

  if (labels[category]) return labels[category];

  if (
    (category === "MOVE_IN" || category === "MOVE_OUT") &&
    labels.MOVE_IN_OUT
  ) {
    return labels.MOVE_IN_OUT;
  }

  return fallback(rawJobType);
}

/**
 * Map a stored jobType onto the category a picker should preselect. Keeps an
 * edited legacy job from silently losing its service because the exact old
 * value is no longer offered.
 */
export function resolveServiceValue(
  rawJobType: string | null | undefined,
  catalog: ServiceCatalogEntry[]
): string {
  if (!rawJobType) return "";
  const category = normalizeJobType(rawJobType);
  if (!category) return "";
  const offered = new Set(activeServices(catalog).map((s) => s.category));
  if (offered.has(category)) return category;
  if ((category === "MOVE_IN" || category === "MOVE_OUT") && offered.has("MOVE_IN_OUT")) {
    return "MOVE_IN_OUT";
  }
  return "";
}

// Property type — apartment/condo vs house (PDF #11, Stage 9).
//
// ## What this is, and what it deliberately is NOT
//
// `Job.propertyType` describes the BUILDING the job is at. It is property
// information, in the same family as `bedCount` / `squareFootage`: it tells a
// cleaner what they are walking into (a stairwell and a buzzer, or a driveway
// and a basement) and it lets an admin filter and report on the mix.
//
// It is NOT the service category. `Job.jobType` answers "what cleaning is this"
// (Residential / Deep / Move-in / Commercial…) and drives pricing rules,
// checklist triggers and service permissions. The two got conflated by the
// BookingKoala importer, which folds the CSV's property words — "House",
// "Apartment", "Condo", "Townhouse", "Detached Home" — into the single service
// category RESIDENTIAL (`CATEGORY_ALIASES` in src/lib/calendar-labels.ts), and
// so threw the property fact away. That aliasing is CORRECT for what it does —
// a house clean and an apartment clean are the same service — and Stage 9 does
// not change it. It captures the property word into this column *before* the
// fold, so nothing is lost and nothing is repurposed.
//
// It also carries NO money. Nothing here derives a price, a threshold or a pay
// figure, which is why it is safe to show on every calendar surface including a
// field lead's (see REDACTED_CALENDAR_KEYS in _calendarScope.ts).
//
// PURE — no DB, no framework, no `@prisma/client` import, no imports at all.
// Client components in three apps (the admin job modal, the public booking
// flow, the cleaner board) render off these labels, so anything server-only
// here would break the build at the far end. The union below mirrors
// `enum PropertyType` in schema.prisma; the verify script asserts they match.

/** `Job.propertyType`. Spelled as a union, not imported — see the header. */
export type PropertyType = "APARTMENT_CONDO" | "HOUSE";

export const PROPERTY_TYPES: readonly PropertyType[] = [
  "APARTMENT_CONDO",
  "HOUSE",
] as const;

export function isPropertyType(v: unknown): v is PropertyType {
  return v === "APARTMENT_CONDO" || v === "HOUSE";
}

/**
 * Decision D8: exactly the PDF's two options ("apartment/condo or house").
 * Extending this later is an enum add plus a label here — deliberately cheap,
 * so v1 does not guess at a taxonomy nobody asked for.
 */
export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = {
  APARTMENT_CONDO: "Apartment / Condo",
  HOUSE: "House",
};

/** Compact form for calendar cards and job-board chips, where space is the constraint. */
export const PROPERTY_TYPE_SHORT_LABEL: Record<PropertyType, string> = {
  APARTMENT_CONDO: "Apt",
  HOUSE: "House",
};

/** One line of plain English per option, for the forms that offer the choice. */
export const PROPERTY_TYPE_HINT: Record<PropertyType, string> = {
  APARTMENT_CONDO: "A unit in a building — buzzer, elevator, shared entrance.",
  HOUSE: "A standalone home, townhouse or duplex — its own front door.",
};

/**
 * Human label for a stored value. Returns null — not "" and not the raw enum —
 * for an unset or unrecognised value, so every caller has to decide out loud
 * whether to render a row at all. Legacy jobs are unset by design (the column
 * is nullable), and "no answer" must never print as "APARTMENT_CONDO".
 */
export function propertyTypeLabel(v: unknown): string | null {
  return isPropertyType(v) ? PROPERTY_TYPE_LABEL[v] : null;
}

/** Short label for a stored value, same null contract as `propertyTypeLabel`. */
export function propertyTypeShortLabel(v: unknown): string | null {
  return isPropertyType(v) ? PROPERTY_TYPE_SHORT_LABEL[v] : null;
}

/**
 * Parse a form value into a column value.
 *
 * The blank option is a real choice on both job forms — "not recorded" is the
 * honest state for the majority of jobs that predate this column and for an
 * admin who does not know yet — so "" (and null, and anything unrecognised)
 * resolves to null rather than to a default. A silent default here would put a
 * guess on every job saved from any form that happens to omit the control.
 */
export function parsePropertyType(v: unknown): PropertyType | null {
  if (typeof v !== "string") return null;
  const up = v.trim().toUpperCase();
  return isPropertyType(up) ? up : null;
}

/**
 * Infer the property type from free text — the BookingKoala import path
 * (step 9.6) and nothing else.
 *
 * The CSV's "Service" column carries values like "House", "Apartment",
 * "Condo", "Townhouse", "Detached Home (2000+ sqft)" alongside genuine service
 * names like "Deep Cleaning" and "Move In & Out". `normalizeJobType` folds the
 * first group into RESIDENTIAL and loses the distinction; this reads the same
 * string BEFORE that fold and keeps it.
 *
 * Returns null for anything that isn't recognisably a property word — a service
 * name, an empty cell, a format nobody has seen yet. Null is the right answer
 * there: the column is nullable, an admin can set it by hand afterwards, and
 * inventing HOUSE for "Deep Cleaning" would be worse than leaving it blank.
 *
 * APARTMENT/CONDO is tested FIRST on purpose. "Townhouse condo" and
 * "Condo house" are the only strings that could match both, and in a mixed
 * phrase the unit word is the specific one — a condo in a townhouse-style
 * building still has the shared-entrance, no-driveway shape a cleaner cares
 * about. Word boundaries keep "Warehouse" from reading as a house.
 */
const APARTMENT_CONDO_RE = /\b(apartments?|apt|condos?|condominiums?|flat|studio|loft)\b/i;
const HOUSE_RE = /\b(houses?|townhouses?|townhomes?|detached|semi-?detached|duplex(?:es)?|bungalows?|cottages?)\b/i;

export function inferPropertyTypeFromText(
  raw: string | null | undefined
): PropertyType | null {
  if (!raw || typeof raw !== "string") return null;
  // "Detached_Home" / "DETACHED-HOME" reach here from normalised sources too,
  // so treat the separators as spaces before the word-boundary match.
  const text = raw.replace(/[_]+/g, " ");
  if (APARTMENT_CONDO_RE.test(text)) return "APARTMENT_CONDO";
  if (HOUSE_RE.test(text)) return "HOUSE";
  return null;
}

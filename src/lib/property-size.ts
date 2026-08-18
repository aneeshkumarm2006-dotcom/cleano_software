// Property size — the five facts that describe how big a place is
// (new photo/address fixes, item 3).
//
// ## What this is
//
// `propertyType` + `bedCount` + `bathCount` + `halfBathCount` + `squareFootage`,
// treated as ONE value rather than five loose columns, because every surface
// that cares cares about all of them together: the job forms pre-fill them as a
// set, the address book stores them as a set, and a cleaner reads them as one
// line.
//
// ## The two stores, and why they are not merged
//
// The same five facts now live in two places, and the split is deliberate:
//
//   • `Job.*`           — the SNAPSHOT this visit was priced and staffed from.
//                         Authoritative for that job forever. A property that
//                         finishes its basement next year must not rewrite last
//                         year's invoice, so nothing here ever writes back into
//                         a saved job from the address.
//   • `ClientAddress.*` — the DEFAULT for the next booking at that door. This is
//                         what item 3 asks for in as many words: "prevent admin
//                         from re-entering the same apartment/house size every
//                         time that customer books."
//
// The address learns from a job only while the address field is still blank
// (`mergeBlankPropertySize` below, used by `upsertClientAddress`). One mistyped
// booking must not overwrite a customer's permanent property record; correcting
// it deliberately is what the address editor is for.
//
// PURE — no DB, no framework, no `@prisma/client` import. Client components in
// three apps render off these helpers, and the verify script exercises them
// without a database.

import {
  isPropertyType,
  propertyTypeLabel,
  propertyTypeShortLabel,
  type PropertyType,
} from "./property-type";

/** The five columns, as they appear on both `Job` and `ClientAddress`. */
export interface PropertySizeParts {
  propertyType?: PropertyType | string | null;
  bedCount?: number | null;
  bathCount?: number | null;
  halfBathCount?: number | null;
  squareFootage?: number | null;
}

/**
 * The four numeric field names, in display order. Exported so the forms and the
 * address upsert iterate one list instead of each repeating the quintet — the
 * bug class this whole module exists to prevent is a sixth surface that handles
 * four of the five.
 */
export const PROPERTY_SIZE_NUMERIC_FIELDS = [
  "bedCount",
  "bathCount",
  "halfBathCount",
  "squareFootage",
] as const;

export type PropertySizeNumericField =
  (typeof PROPERTY_SIZE_NUMERIC_FIELDS)[number];

/** Every field of a property size, numeric ones plus the building type. */
export const PROPERTY_SIZE_FIELDS = [
  "propertyType",
  ...PROPERTY_SIZE_NUMERIC_FIELDS,
] as const;

/**
 * Coerce a form value to a stored count.
 *
 * Returns null for blank, non-numeric and NEGATIVE input — but **0 survives**,
 * because "0 half-baths" and "0 bedrooms" (a studio) are real answers a
 * customer gives. That distinction is the whole reason this is a function and
 * not `Number(v) || null`, which would silently turn a studio into "not
 * recorded" and re-prompt the admin forever.
 */
export function parsePropertyCount(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
  }
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** Normalise a loose record (a form, a CSV row, a job) into a property size. */
export function readPropertySize(src: PropertySizeParts): {
  propertyType: PropertyType | null;
  bedCount: number | null;
  bathCount: number | null;
  halfBathCount: number | null;
  squareFootage: number | null;
} {
  return {
    propertyType: isPropertyType(src.propertyType) ? src.propertyType : null,
    bedCount: parsePropertyCount(src.bedCount),
    bathCount: parsePropertyCount(src.bathCount),
    halfBathCount: parsePropertyCount(src.halfBathCount),
    squareFootage: parsePropertyCount(src.squareFootage),
  };
}

/** Does this row record anything at all about the property's size? */
export function hasPropertySize(src: PropertySizeParts): boolean {
  const s = readPropertySize(src);
  return (
    s.propertyType !== null ||
    s.bedCount !== null ||
    s.bathCount !== null ||
    s.halfBathCount !== null ||
    s.squareFootage !== null
  );
}

/**
 * The patch that teaches `target` what `source` knows — **blanks only**.
 *
 * Same rule the address book already applies to city / postal code / access
 * notes (`upsertClientAddress`): a value already on the row wins, so saving a
 * job with the bedroom field left empty can never erase what an admin typed on
 * the customer's address, and a booking that says "2 bedrooms" can never
 * overwrite the "3" someone recorded after actually going there.
 *
 * Returns `{}` when there is nothing to learn, so callers can skip the write.
 */
export function mergeBlankPropertySize(
  target: PropertySizeParts,
  source: PropertySizeParts
): Partial<Record<(typeof PROPERTY_SIZE_FIELDS)[number], PropertyType | number>> {
  const have = readPropertySize(target);
  const learn = readPropertySize(source);
  const patch: Record<string, PropertyType | number> = {};

  if (learn.propertyType !== null && have.propertyType === null) {
    patch.propertyType = learn.propertyType;
  }
  for (const f of PROPERTY_SIZE_NUMERIC_FIELDS) {
    const next = learn[f];
    if (next !== null && have[f] === null) patch[f] = next;
  }
  return patch;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * One line of plain English: "House · 3 bedrooms, 2 baths, 1 half bath, 1,450 sq ft".
 *
 * Returns null — not "" — when nothing is recorded, so every caller decides out
 * loud whether to render a row at all rather than printing an empty label. Same
 * contract as `propertyTypeLabel`.
 */
export function formatPropertySize(src: PropertySizeParts): string | null {
  const s = readPropertySize(src);
  const bits: string[] = [];
  if (s.bedCount !== null) bits.push(plural(s.bedCount, "bedroom"));
  if (s.bathCount !== null) bits.push(plural(s.bathCount, "bath"));
  if (s.halfBathCount !== null && s.halfBathCount > 0) {
    bits.push(plural(s.halfBathCount, "half bath"));
  }
  if (s.squareFootage !== null && s.squareFootage > 0) {
    bits.push(`${s.squareFootage.toLocaleString("en-US")} sq ft`);
  }

  const type = propertyTypeLabel(s.propertyType);
  if (bits.length === 0) return type;
  const detail = bits.join(", ");
  return type ? `${type} · ${detail}` : detail;
}

/**
 * Compact form for chips and dropdown labels: "House · 3bd 2ba 1450sqft".
 * Same null contract.
 */
export function formatPropertySizeShort(src: PropertySizeParts): string | null {
  const s = readPropertySize(src);
  const bits: string[] = [];
  if (s.bedCount !== null) bits.push(`${s.bedCount}bd`);
  if (s.bathCount !== null) {
    // A half bath is written the way listings write it — "2.5ba" — rather than
    // as a fourth chip, because the whole point of the short form is one glance.
    const half = s.halfBathCount && s.halfBathCount > 0 ? 0.5 : 0;
    bits.push(`${s.bathCount + half}ba`);
  }
  if (s.squareFootage !== null && s.squareFootage > 0) {
    bits.push(`${s.squareFootage.toLocaleString("en-US")}sqft`);
  }

  const type = propertyTypeShortLabel(s.propertyType);
  if (bits.length === 0) return type;
  const detail = bits.join(" ");
  return type ? `${type} · ${detail}` : detail;
}

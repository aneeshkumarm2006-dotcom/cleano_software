/**
 * Saved client addresses — the PURE rules of the address book.
 *
 * awerfixes.pdf item 2 (round 3, stage 4). Before this stage three call sites
 * each invented their own answer to "have we already saved this address?" and
 * "how do I print it":
 *
 *   • admin/jobs/new/page.tsx  — exact, case-sensitive `address` match that
 *                                IGNORED aptNumber, so a second unit at the
 *                                same street was silently dropped; labelled
 *                                every new row "Other".
 *   • runBookingKoalaImport.ts — normalised case/whitespace, but wrote the unit
 *                                into BOTH the address string ("Apt 12 – 4820
 *                                Sherbrooke") and `aptNumber`, so the manager
 *                                rendered it twice; labelled rows
 *                                Home/Address 2/Address 3.
 *   • saveJob.ts               — nothing at all. The admin modal's edits never
 *                                reached the address book.
 *
 * All three now go through this module (writes via `upsertClientAddress` in
 * ./client-address-store, which is the half that touches the database).
 *
 * NOTHING HERE IMPORTS PRISMA — deliberately. scripts/verify-awer-fixes-3.ts
 * may never touch the database, and its house doctrine prefers BEHAVIOUR checks
 * (import the logic and exercise it) over grepping source. Keeping the rules
 * pure is what makes that possible. The two imports below are TYPE-ONLY and
 * reach only other pure modules, so that still holds.
 */

import type { PropertySizeParts } from "./property-size";
import type { PropertyType } from "./property-type";

/** The address fields shared by a saved row, a job snapshot, and a form. */
export interface AddressParts extends PropertySizeParts {
  address?: string | null;
  aptNumber?: string | null;
  city?: string | null;
  postalCode?: string | null;
}

/**
 * A saved row as every picker and manager consumes it.
 *
 * Carries the PROPERTY SIZE as well as the address since the new photo/address
 * fixes (item 3): the size belongs to the door, not to each booking at it, so a
 * picker that hands back an address hands back how big it is in the same object.
 * All five are nullable — "not recorded" is the state of every row saved before
 * the columns existed, and of any address nobody has been to yet.
 */
export interface SavedAddress extends AddressParts {
  id: string;
  label: string;
  address: string;
  aptNumber: string | null;
  city: string | null;
  postalCode: string | null;
  accessNotes: string | null;
  propertyType: PropertyType | null;
  bedCount: number | null;
  bathCount: number | null;
  halfBathCount: number | null;
  squareFootage: number | null;
  isDefault: boolean;
}

/** The sentinel the "+ Type a new address" option carries in every picker. */
export const NEW_ADDRESS = "__new__";

/** Label given to the very first address ever saved for a client. */
export const FIRST_ADDRESS_LABEL = "Home";
/** Label given to every subsequent auto-saved address. */
export const EXTRA_ADDRESS_LABEL = "Other";

const squash = (s?: string | null) =>
  (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Joins the street and unit halves of a de-duplication key. Written as an
 * escape, never as a raw byte: a literal NUL in the source would make git,
 * grep and the verify script treat this file as binary.
 */
const KEY_SEP = "\u0000";

/** Separators an importer or a human might put between a unit and a street. */
const LEADING_SEP = /^\s*[–—\-,|/]+\s*/;
const TRAILING_SEP = /\s*[–—\-,|/]+\s*$/;

/**
 * Remove the unit from the street string when it is ALSO held in `aptNumber`.
 *
 * The BookingKoala importer stores `"Apt 12 – 4820 Sherbrooke"` in `address`
 * while separately setting `aptNumber: "Apt 12"`, so anything that prints
 * `address` then `aptNumber` shows the unit twice. Rather than special-case the
 * importer at every render site, every render site strips here.
 *
 * Conservative by construction: if stripping would empty the street (the row
 * holds nothing but a unit), the original is returned untouched.
 */
export function stripDuplicatedApt(
  address?: string | null,
  aptNumber?: string | null
): string {
  const addr = (address ?? "").trim();
  const apt = (aptNumber ?? "").trim();
  if (!addr || !apt) return addr;

  const lowerAddr = addr.toLowerCase();
  const lowerApt = apt.toLowerCase();

  // Leading — "Apt 12 – 4820 Sherbrooke".
  if (lowerAddr.startsWith(lowerApt)) {
    const rest = addr.slice(apt.length);
    const stripped = rest.replace(LEADING_SEP, "").trim();
    // `stripped !== rest.trim()` proves a separator was actually consumed, so
    // "Apt 1200 Main" isn't mangled by the apt "Apt 12" prefix-matching it.
    if (stripped && stripped !== rest.trim()) return stripped;
  }

  // Trailing — "4820 Sherbrooke, Apt 12".
  if (lowerAddr.endsWith(lowerApt)) {
    const head = addr.slice(0, addr.length - apt.length);
    const stripped = head.replace(TRAILING_SEP, "").trim();
    if (stripped && stripped !== head.trim()) return stripped;
  }

  return addr;
}

/* ═══════════════════════════════════════════════════════════════════════════
   ROUND 4, FIX 7 — finding the apartment when nobody put it in `aptNumber`.
   ═══════════════════════════════════════════════════════════════════════════

   `stripDuplicatedApt` above solves the easy half: the unit is in BOTH the
   street string and the column, so one of them is redundant. The screenshot on
   p6 of `awerfixesaug18.pdf` is the hard half — the unit is in the street
   string and NOWHERE else:

     "5550 Chemin de la Côte Saint-Luc, Montreal, QC, Canada, 23"
                                                             ^^ apartment 23

   Rendered through `formatAddressLine` that is one long line ending in a bare
   number, which is exactly how a cleaner drives to the right building and
   knocks on the wrong door. To give the unit its own line, something first has
   to know which part of the string IS the unit.

   These rules are deliberately timid, because they also feed a backfill that
   writes to `Job.aptNumber`. A wrong split is worse than no split: it invents
   an apartment that doesn't exist and, in the trailing case, deletes a real
   piece of the street. So:

     • A LEADING unit must be labelled. "Apt 12 – 4820 Sherbrooke" splits;
       "5550 Chemin de la Côte" never does, because a leading bare number is a
       street number, always.
     • A TRAILING unit may be bare, but only in the shapes a unit actually
       takes (23 · 12B · B12), and never one that is really a postal code.
     • A labelled unit must contain a digit. Without that rule "Ste Foy" reads
       as suite "Foy" — and this is Montréal, where half the South Shore is a
       Sainte-something.
     • When nothing matches, the string is returned untouched. Silence is a
       correct answer here; a guess is not. */

/**
 * Designator words a form, an importer or a human writes in front of a unit.
 * Bilingual: "Apt 4" and "App 4" turn up in the same address book here.
 * Longest alternatives first — `app` before `appartement` would swallow it.
 */
const UNIT_DESIGNATOR =
  "appartement|apartment|appt\\.?|apt\\.?|app\\.?|unité|unite|unit|suite|ste\\.?|local|bureau|no\\.|nº|#";

/** A designator followed by the unit itself: "Apt 4B", "#1204", "Suite 300". */
const LABELLED_UNIT = new RegExp(
  `^(?:${UNIT_DESIGNATOR})\\s*([A-Za-z0-9][A-Za-z0-9\\s-]{0,9})$`,
  "i"
);

/** Does this text START with a designator? Used for display, not for splitting. */
const DESIGNATOR_PREFIX = new RegExp(`^(?:${UNIT_DESIGNATOR})(?![A-Za-z])`, "i");

/**
 * A unit written without a designator: "23", "12B", "12 B", "B12".
 * Capped at four digits so a five-digit US ZIP can never read as an apartment.
 */
const BARE_UNIT = /^(?:\d{1,4}\s?-?\s?[A-Za-z]?|[A-Za-z]\s?-?\s?\d{1,4})$/;

/**
 * A Canadian postal code. Tested FIRST and rejected outright: "H3Z 1H2" is the
 * one thing that sits at the end of an address, is short, and mixes letters
 * with digits — i.e. it is the false positive this whole module risks.
 */
const POSTAL_CODE = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/;

/** Head / separator / tail, splitting on the FIRST separator only. */
const LEADING_SPLIT = /^([^,–—|/]+?)\s*(?:[,–—|/]|\s-\s)\s*(.+)$/;

/** A labelled unit at the very end of a string that has no commas at all. */
const TRAILING_LABELLED = new RegExp(
  `\\s((?:${UNIT_DESIGNATOR})\\s*[A-Za-z0-9][A-Za-z0-9\\s-]{0,9})$`,
  "i"
);

/** Could this fragment be a unit on its own? */
function looksLikeUnit(fragment: string, labelledOnly = false): boolean {
  const t = fragment.trim();
  if (!t || t.length > 14) return false;
  if (POSTAL_CODE.test(t)) return false;
  const labelled = t.match(LABELLED_UNIT);
  // A designator with no number behind it is a place name, not a unit.
  if (labelled) return /\d/.test(labelled[1]);
  if (labelledOnly) return false;
  return BARE_UNIT.test(t) && /\d/.test(t);
}

/** What `splitAptFromLocation` hands back. */
export interface SplitAddress {
  /** The street with the unit removed. Equal to the input when none was found. */
  street: string;
  /** The unit exactly as it was written, or null. */
  apt: string | null;
}

/**
 * Pull the unit out of a raw street string, for the rows where `aptNumber` is
 * empty. The sibling of `stripDuplicatedApt`: that one knows the unit and
 * removes it, this one has to find it first — and so it RETURNS what it took.
 *
 * Never invents: when no rule fires the input comes back untouched with a null
 * apt, and the caller renders exactly what it renders today.
 */
export function splitAptFromLocation(location?: string | null): SplitAddress {
  const raw = (location ?? "").trim();
  if (!raw) return { street: "", apt: null };

  // 1 — leading, labelled only ("Apt 12 – 4820 Sherbrooke", the shape the
  //     BookingKoala importer used to write; see the header of this file).
  const lead = raw.match(LEADING_SPLIT);
  if (lead) {
    const head = lead[1].trim();
    const rest = lead[2].trim();
    if (rest && looksLikeUnit(head, true)) return { street: rest, apt: head };
  }

  // 2 — the last comma-separated segment, labelled or bare. This is IMG-5.
  const comma = raw.lastIndexOf(",");
  if (comma > 0) {
    const tail = raw.slice(comma + 1).trim();
    const head = raw.slice(0, comma).trim();
    if (head && looksLikeUnit(tail)) return { street: head, apt: tail };
  }

  // 3 — a labelled unit at the end of a comma-less string ("14 Main St Apt 3").
  const trail = raw.match(TRAILING_LABELLED);
  if (trail?.index != null && /\d/.test(trail[1])) {
    const head = raw.slice(0, trail.index).trim();
    if (head) return { street: head, apt: trail[1].trim() };
  }

  return { street: raw, apt: null };
}

/**
 * Values that mean "no apartment" even though the column is not empty.
 *
 * Not hypothetical: three live jobs on this database have `aptNumber = "None"`.
 * Fix 7 puts the unit on its own bold line, which turns that from a harmless
 * trailing token into a prominent "Apt None" — worse than showing nothing. So
 * a placeholder is read as blank everywhere the unit is read.
 */
const APT_PLACEHOLDER = /^(?:none|n\/?a|nil|null|no|-{1,2}|—|\.)$/i;

/** The unit, or null when the column is empty or holds a placeholder. */
export function normalizeApt(apt?: string | null): string | null {
  const t = (apt ?? "").trim();
  return !t || APT_PLACEHOLDER.test(t) ? null : t;
}

/**
 * A value short and unit-shaped enough to read "Apt" in front of: "23", "8E",
 * "PH2". Requires a digit, which is what keeps "Basement" out.
 */
const PREFIXABLE_UNIT = /^[A-Za-z0-9][A-Za-z0-9\s-]{0,7}$/;

/**
 * How a unit is written when it is shown on its own, away from the street.
 *
 *   "23"                       → "Apt 23"
 *   "Suite 300" · "#12"        → unchanged; the designator is never doubled
 *   "Door C (locks after 6pm)" → unchanged; a live row really says this, and
 *                                "Apt Door C (locks after 6pm)" helps nobody
 *   "None"                     → null
 */
export function formatAptLabel(apt?: string | null): string | null {
  const t = normalizeApt(apt);
  if (!t) return null;
  if (DESIGNATOR_PREFIX.test(t)) return t;
  return PREFIXABLE_UNIT.test(t) && /\d/.test(t) ? `Apt ${t}` : t;
}

/** An address broken into the pieces a screen renders separately. */
export interface ResolvedAddress {
  /** Street only — no unit. Safe to hand to a geocoder. */
  street: string;
  /** The unit as stored or as recovered from the street string. */
  apt: string | null;
  /** The unit as it should be DISPLAYED ("Apt 23"). */
  aptLabel: string | null;
  city: string | null;
  postalCode: string | null;
}

/**
 * The one place that answers "where is the apartment number on this row?".
 *
 * The column wins when it has anything in it — that is what an admin typed, or
 * what the importer mapped from the Apt column — and the street string is then
 * only cleaned of a duplicate. Only when the column is empty does the split
 * above go looking. Both paths end in the same shape, so a caller never has to
 * care which of the two storage habits produced the row it is rendering.
 */
export function resolveAddressParts(a: AddressParts): ResolvedAddress {
  const stored = normalizeApt(a.aptNumber);
  const { street, apt } = stored
    ? { street: stripDuplicatedApt(a.address, stored), apt: stored }
    : splitAptFromLocation(a.address);

  return {
    street,
    apt: apt || null,
    aptLabel: formatAptLabel(apt),
    city: (a.city ?? "").trim() || null,
    postalCode: (a.postalCode ?? "").trim() || null,
  };
}

/**
 * The line the cleaner's Copy button puts on the clipboard.
 *
 * Apartment INCLUDED and labelled — the PDF is explicit about it, and copying
 * an address that silently drops the unit is how the round-3 Copy button sent
 * people to buildings with no way in. Differs from `formatAddressLine` in
 * exactly that: the unit is labelled rather than left as a bare trailing
 * number, because the bare trailing number is the bug.
 */
export function formatAddressCopy(a: AddressParts): string {
  const p = resolveAddressParts(a);
  const locality = [p.city, p.postalCode].filter(Boolean).join(" ");
  return [p.street, p.aptLabel, locality].filter(Boolean).join(", ");
}

/**
 * The query handed to Waze / Google Maps / Apple Maps — street, city, postal
 * code, and deliberately NO unit. Geocoders get worse at finding a building
 * when a unit is in the query, and the PDF asks for the apartment in the
 * navigation links only "when possible". Legibility on the screen and on the
 * clipboard is where fix 7 is actually won.
 */
export function formatAddressQuery(a: AddressParts): string {
  const p = resolveAddressParts(a);
  const locality = [p.city, p.postalCode].filter(Boolean).join(" ");
  return [p.street, locality].filter(Boolean).join(", ");
}

/**
 * The de-duplication key for "is this address already in the book?".
 *
 * Case- and whitespace-insensitive, and **includes the unit** — two apartments
 * at one street are two addresses, which the old inline check in
 * admin/jobs/new/page.tsx got wrong. Runs the street through
 * `stripDuplicatedApt` first so a BookingKoala-imported row and a
 * hand-typed one for the same door collapse to the same key instead of
 * creating a duplicate.
 *
 * NUL joins the two halves because it cannot occur in a typed address, so no
 * street/unit pair can be shuffled across the delimiter into a false match.
 */
export function normalizeAddressKey(
  address?: string | null,
  aptNumber?: string | null
): string {
  return [
    squash(stripDuplicatedApt(address, aptNumber)),
    squash(aptNumber),
  ].join(KEY_SEP);
}

/** Do these two addresses describe the same door? */
export function sameAddress(a: AddressParts, b: AddressParts): boolean {
  return (
    normalizeAddressKey(a.address, a.aptNumber) ===
    normalizeAddressKey(b.address, b.aptNumber)
  );
}

/**
 * One-line rendering, used by the address manager, every dropdown label, the
 * cleaner job page and the invoice's Service address block — so the unit can
 * never be printed twice on one surface and not another.
 *
 *   "4820 Rue Sherbrooke, Apt 12B, Montréal H3Z 1H2"
 */
export function formatAddressLine(a: AddressParts): string {
  const parts: string[] = [];

  const street = stripDuplicatedApt(a.address, a.aptNumber);
  if (street) parts.push(street);

  // `normalizeApt`, not a bare trim (round 4, fix 7): three live rows store the
  // string "None" in this column, and "4820 Sherbrooke, None, Montréal" has
  // been going out on invoices. Display only — `normalizeAddressKey` below is
  // deliberately NOT normalised, because two rows whose units differ only by a
  // placeholder are still two rows and merging them would lose one.
  const apt = normalizeApt(a.aptNumber);
  if (apt) parts.push(apt);

  const locality = [(a.city ?? "").trim(), (a.postalCode ?? "").trim()]
    .filter(Boolean)
    .join(" ");
  if (locality) parts.push(locality);

  return parts.join(", ");
}

/**
 * Which saved address should be pre-selected: the one flagged default, else the
 * first (the queries order `isDefault desc, createdAt asc`), else nothing.
 * Extracted from ClientNameField, which had it inline.
 */
export function pickDefaultAddress<T extends { isDefault: boolean }>(
  list: readonly T[] | null | undefined
): T | null {
  if (!list || list.length === 0) return null;
  return list.find((a) => a.isDefault) ?? list[0] ?? null;
}

/** The option text every saved-address dropdown shows. */
export function addressOptionLabel(a: SavedAddress): string {
  return `${a.label} — ${formatAddressLine(a)}${a.isDefault ? " · default" : ""}`;
}

/**
 * Label for an auto-saved address: the client's first is "Home", the rest are
 * "Other". Replaces two conflicting conventions (jobs/new's always-"Other" and
 * the importer's Home/Address 2/Address 3). Admins rename freely afterwards.
 */
export function autoAddressLabel(existingCount: number): string {
  return existingCount === 0 ? FIRST_ADDRESS_LABEL : EXTRA_ADDRESS_LABEL;
}

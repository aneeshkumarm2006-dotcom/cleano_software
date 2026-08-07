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
 * pure is what makes that possible.
 */

/** The address fields shared by a saved row, a job snapshot, and a form. */
export interface AddressParts {
  address?: string | null;
  aptNumber?: string | null;
  city?: string | null;
  postalCode?: string | null;
}

/** A saved row as every picker and manager consumes it. */
export interface SavedAddress extends AddressParts {
  id: string;
  label: string;
  address: string;
  aptNumber: string | null;
  city: string | null;
  postalCode: string | null;
  accessNotes: string | null;
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

  const apt = (a.aptNumber ?? "").trim();
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

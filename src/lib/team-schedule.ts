// The two withholding rules behind the Field Lead's group schedule (PDF #7).
//
// PURE module — no imports at all — so `scripts/verify-stage7-field-lead.ts` can
// exercise them directly. That matters more than usual here: these are not
// formatting helpers, they are the functions that decide how much of a client's
// identity and address reaches someone who is not on the job. A rule that only
// runs inside a `"use server"` action cannot be tested, and an untested privacy
// rule is an assumption.
//
// See `src/app/admin/actions/getMyTeam.types.ts` for the full list of what the
// My Team payload withholds and why.

/**
 * A client's FIRST name only ("Sarah Chen" → "Sarah").
 *
 * Enough for a lead to recognise the booking when a cleaner phones about it;
 * not a contact record. Falls back to "Client" rather than to an empty string,
 * so a row can never render as a nameless gap that looks like a bug.
 */
export function clientFirstName(clientName: string | null | undefined): string {
  const first = (clientName ?? "").trim().split(/\s+/)[0];
  return first || "Client";
}

/**
 * The trailing locality of an address ("1234 Rue Wellington, Verdun" →
 * "Verdun"). Null when there is no locality to extract.
 *
 * ⚠️ NOT the same rule as `shortLocation()` in
 * `src/components/calendar/status-meta.ts`, and deliberately so. That one takes
 * the last comma-separated segment unconditionally, which for a single-segment
 * address means it returns the STREET — fine on an admin calendar card, wrong
 * here. A Field Lead is not necessarily assigned to their group's jobs, so this
 * returns null rather than falling back to the full address: the area is a
 * planning aid ("who is south of the river today"), not a door to knock on.
 * Whoever is actually on the job gets the street from their own job page.
 *
 * Empty segments are dropped first, so a trailing comma ("…, Verdun,") does not
 * yield an empty area.
 */
export function addressArea(location: string | null | undefined): string | null {
  if (!location) return null;
  const parts = location
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  return parts[parts.length - 1] || null;
}

/**
 * What occupies a cleaner seat.
 *
 * Pure, and deliberately separate from plan-limits.ts, which needs a database
 * and is therefore server-only. These two rules decide whether a customer is
 * blocked at four of five or allowed a seventh, so they are worth being able to
 * exercise on their own.
 */

/**
 * The definition of a seat, in one place.
 *
 * The console reports usage and the app enforces it. If those two ever described
 * "a cleaner" differently, the screen showing the number would be the last place
 * anyone looked — so both import this rather than restating it.
 *
 * Deactivated and soft-deleted people hold no seat. That is the point of
 * deactivating someone: an admin at the cap can free a seat without destroying
 * the history attached to that person.
 */
export const CLEANER_SEAT_WHERE = {
  role: "EMPLOYEE",
  isActive: true,
  deletedAt: null,
} as const;

type SeatState = { role: string; isActive: boolean; deletedAt?: Date | null };

function occupies(s: SeatState): boolean {
  return s.role === "EMPLOYEE" && s.isActive && !s.deletedAt;
}

/**
 * True when a change would newly occupy a seat.
 *
 * Hiring is not the only way to use one up: reactivating a login, converting an
 * applicant, restoring an archived person and promoting someone into the cleaner
 * role all do it too, and each lives in a different action under a different
 * name. Deciding from before-and-after rather than from what the operation is
 * called is what keeps those paths agreeing with each other.
 *
 * `before` is null for someone who does not exist yet.
 */
export function takesASeat(
  before: SeatState | null,
  after: { role: string; isActive: boolean },
): boolean {
  const had = before ? occupies(before) : false;
  return !had && occupies(after);
}

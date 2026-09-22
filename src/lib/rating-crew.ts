// Who a customer's star rating actually lands on.
//
// Sept 10, item 11. The client's rule, confirmed 2026-09-22: a rating applies
// to EVERY cleaner assigned to that job, with no per-cleaner adjustment. Four
// stars on a three-person job is four stars each.
//
// This exists because the two rating paths had drifted into different answers
// to the same question. The public rating link rated every cleaner on the job;
// the customer portal rated ONLY the job's lead, so on a three-person job two
// cleaners' work vanished. Worse, `employeeId` is the LEAD field, and on older
// jobs it can still hold the acting admin — so a customer's rating could be
// filed against an administrator, and ratings feed the pay tiers.
//
// PURE. No database, no imports. Both callers resolve their own rows and then
// ask this one function, so there is one definition of "the crew" to get wrong
// instead of two.

export interface RatingCrewInput {
  /** A token issued for ONE named cleaner. When set, nothing else applies. */
  tokenCleanerId?: string | null;
  /** The live crew relation. */
  cleaners: readonly { id: string }[];
  /** The job's lead. May be null, and on legacy rows may be an admin. */
  employeeId?: string | null;
  /**
   * True when `employeeId` names an ADMIN or OWNER rather than someone who
   * cleans. Those are never rated, for the same reason they are never paid
   * (see `jobParticipantIds` in cleaner-earnings.ts).
   */
  leadIsAdmin?: boolean;
}

/**
 * The cleaners a rating should be written against, de-duplicated.
 *
 * Order is stable — crew first, then the lead if it is not already among them —
 * so a caller writing rows in a loop produces the same result every time.
 */
export function ratedCleanerIds(input: RatingCrewInput): string[] {
  if (input.tokenCleanerId) return [input.tokenCleanerId];

  const ids: string[] = [];
  for (const c of input.cleaners) {
    if (c.id && !ids.includes(c.id)) ids.push(c.id);
  }

  // The lead counts as crew unless they are an administrator. On a claimed job
  // the lead is already in `cleaners`, so this only adds the older shape where
  // the M2M row was never written.
  const lead = input.employeeId;
  if (lead && !input.leadIsAdmin && !ids.includes(lead)) ids.push(lead);

  return ids;
}

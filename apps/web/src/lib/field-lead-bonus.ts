// Field Lead weekly group-revenue bonus (spec item 4).
//
//   • Bonus = 2% of the group's total weekly revenue when the group's average
//     rating for the week is 4.5 stars or BELOW.
//   • Bonus = 3% of the group's total weekly revenue when the group's average
//     rating for the week is ABOVE 4.5 stars.
//   • The bonus is based on the TEAM/GROUP average rating, not the Field Lead's
//     personal rating.
//
// This module is pure (no DB). The server helper getFieldLeadWeeklyBonus in
// field-lead-bonus.server.ts gathers the group revenue + rating and calls this.

export const BONUS_RATE_LOW = 0.02; // group avg rating <= 4.5
export const BONUS_RATE_HIGH = 0.03; // group avg rating > 4.5
export const BONUS_RATING_THRESHOLD = 4.5;

export function bonusRateForGroupRating(groupAvgRating: number | null): number {
  // No ratings yet → treat as the lower tier.
  if (groupAvgRating == null) return BONUS_RATE_LOW;
  return groupAvgRating > BONUS_RATING_THRESHOLD ? BONUS_RATE_HIGH : BONUS_RATE_LOW;
}

export interface FieldLeadBonus {
  groupRevenue: number;
  groupAvgRating: number | null;
  bonusRate: number;
  bonusAmount: number;
}

export function computeFieldLeadBonus(
  groupRevenue: number,
  groupAvgRating: number | null
): FieldLeadBonus {
  const bonusRate = bonusRateForGroupRating(groupAvgRating);
  const bonusAmount = Math.round(Math.max(0, groupRevenue) * bonusRate * 100) / 100;
  return { groupRevenue, groupAvgRating, bonusRate, bonusAmount };
}

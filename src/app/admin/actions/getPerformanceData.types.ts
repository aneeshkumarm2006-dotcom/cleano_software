export type RecentRating = {
  id: string;
  rating: number;
  notes: string | null;
  createdAt: string;
  /** Set when the client edited their submitted rating. */
  editedAt: string | null;
  jobId: string | null;
  clientName: string | null;
};

export type TrendPoint = {
  date: string;
  average: number;
  count: number;
};

export type PerformanceData = {
  /**
   * The multiplier that actually prices this cleaner's pay, resolved from the
   * ALL-TIME rating average (Decision 2). Read live through
   * getCleanerRateInputs, not from the User.payMultiplier cache.
   */
  currentMultiplier: number;
  /** True below `ratingsRequired` ratings — the multiplier is pinned at 1.00. */
  multiplierLocked: boolean;
  ratingsRequired: number;
  /** ALL-TIME average of non-excluded ratings. THE number that sets pay. */
  ratingAllTime: number | null;
  ratingCountAllTime: number;
  /** Recent form only — a trend display, never a pay input. */
  rating30Day: number | null;
  ratingCount30Day: number;
  /** The 0.1 rating STEP the multiplier was priced at, e.g. "4.5". */
  tierLabel: string | null;
  nextTierAt: number | null;
  nextTierMultiplier: number | null;
  trend90Day: TrendPoint[];
  recentRatings: RecentRating[];
};

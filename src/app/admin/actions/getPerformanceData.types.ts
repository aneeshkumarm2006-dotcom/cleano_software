export type RecentRating = {
  id: string;
  rating: number;
  notes: string | null;
  createdAt: string;
  jobId: string | null;
  clientName: string | null;
};

export type TrendPoint = {
  date: string;
  average: number;
  count: number;
};

export type PerformanceData = {
  currentMultiplier: number;
  rating30Day: number | null;
  ratingCount30Day: number;
  tierLabel: string;
  nextTierAt: number | null;
  nextTierMultiplier: number | null;
  trend90Day: TrendPoint[];
  recentRatings: RecentRating[];
  oldestRating30DayAt: string | null;
  expiringSoon: number;
};

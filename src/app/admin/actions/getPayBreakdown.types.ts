// Two payload shapes, one action (item 1).
//
// Cleaners must NEVER see internal pricing/payroll mechanics: client charges,
// base price, discounts, the client total, their tier, their % of price, or the
// split-pool math. They only ever see what they are paid. Redaction happens on
// the SERVER (getPayBreakdown.ts) — the fields simply do not exist in the
// response a cleaner receives.

export type JobPayType = "PERCENTAGE" | "FLAT" | "HOURLY";

/** What a cleaner is allowed to see about their own pay for a job. */
export type CleanerPayBreakdown = {
  audience: "CLEANER";
  jobId: string;
  clientName: string;
  payType: JobPayType;
  /** Only populated for HOURLY jobs. */
  hourlyRate: number | null;
  /** This cleaner's share of the job's tips (their own money — not internal). */
  tipShare: number;
  /** The bottom line: what this cleaner gets paid for this job. */
  totalEmployeePay: number;
};

/** The full internal breakdown. ADMIN/OWNER only. */
export type AdminPayBreakdown = {
  audience: "ADMIN";
  jobId: string;
  clientName: string;
  bedCount: number | null;
  bathCount: number | null;
  basePrice: number | null;
  basePriceSource: "PRICING_RULE" | "JOB_PRICE" | "NONE";
  addOns: Array<{ name: string; price: number }>;
  addOnsTotal: number;
  discount: number;
  parking: number;
  clientTotal: number;
  payType: JobPayType;
  hourlyRate: number | null;
  employeeBasePay: number;
  payMultiplier: number;
  payAfterMultiplier: number;
  totalTip: number;
  teamSize: number;
  tipShare: number;
  totalEmployeePay: number;
  isLead: boolean;
  // Tier-based pay context (src/lib/pay-tiers.ts)
  tier: "TRAINEE" | "STANDARD" | "FIELD_LEAD";
  individualRate: number; // fraction of job price for this cleaner
  isSplit: boolean; // true when 2+ cleaners are on the job (each paid their own rate)
  poolTotal: number; // total cleaner cost of the job (sum of every cleaner's pay)
};

export type PayBreakdown = CleanerPayBreakdown | AdminPayBreakdown;

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
  /**
   * This cleaner's share of the job's parking / transportation (D3). Customer-
   * funded and split evenly exactly like the tip, so — like the tip — it is the
   * cleaner's own money and safe to show them.
   */
  parkingShare: number;
  /** The bottom line: what this cleaner gets paid for this job. */
  totalEmployeePay: number;
  /**
   * Whether this cleaner's rating is boosting their pay on THIS job, and why
   * not when it isn't (awerfixes.pdf item 1).
   *
   * A discriminated union rather than a bare number, so the modal can never
   * render "1.00x" on a fixed-amount job and imply a penalty. Nothing internal
   * leaks: the multiplier and the average are the cleaner's own facts, and the
   * job price, the tier and the base rate are still absent from this payload.
   */
  ratingBoost:
    | { state: "APPLIED"; multiplier: number; averageRating: number | null }
    | { state: "LOCKED"; ratingsSoFar: number; ratingsRequired: number }
    | { state: "NOT_APPLICABLE"; reason: "FIXED_AMOUNT" | "FLAT" | "HOURLY" };
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
  /** `price` is the UNIT price; `lineTotal` is `price * quantity`. */
  addOns: Array<{
    name: string;
    price: number;
    quantity: number;
    lineTotal: number;
  }>;
  addOnsTotal: number;
  discount: number;
  parking: number;
  clientTotal: number;
  /**
   * How the CUSTOMER is billed (Stage 8 / PDF #8), and — on an hourly job — the
   * `rate × hours` line the pay basis is a percentage of. ADMIN-ONLY on
   * purpose: `billedHourlyRate` is a client charge, which is exactly the class
   * of number the cleaner payload above exists to withhold. Nothing here is
   * `payType`/`hourlyRate` two lines below, which is the cleaner's pay.
   */
  billingType: "FLAT" | "HOURLY";
  billedHourlyRate: number | null;
  billedEstimatedHours: number | null;
  billedActualHours: number | null;
  /** "4h × $60.00/hr = $240.00", or null when not billed hourly. */
  billedHourlyLine: string | null;
  payType: JobPayType;
  hourlyRate: number | null;
  /** Pay at the bare TIER BASE rate, before the rating multiplier. */
  employeeBasePay: number;
  /**
   * The RESOLVED multiplier for THIS cleaner — their all-time rating average
   * priced by Settings → `multipliers.ratings`. NOT the retired per-job
   * `Job.payRateMultiplier` column, which this used to read (awerfixes.pdf
   * item 1).
   */
  payMultiplier: number;
  /** False on FLAT/HOURLY and on any manually overridden cleaner. */
  payMultiplierApplies: boolean;
  /** One-line provenance, e.g. "4.52★ all-time · 9 ratings". */
  payMultiplierSource: string;
  payAfterMultiplier: number;
  totalTip: number;
  teamSize: number;
  tipShare: number;
  /** This cleaner's even share of `parking` (D3 pass-through). */
  parkingShare: number;
  /**
   * The job's PAY BASIS: base + add-ons, or the stored override total (fix 5).
   * What the percentage model is a fraction of. Distinct from `basePrice`, which
   * is the bare service line the add-ons sit on top of.
   */
  payBasis: number;
  /**
   * D2 — TRUE when `employeePay` is an authoritative manual TEAM TOTAL being
   * paid out, FALSE when the tier calculation is in charge. Drives the
   * "Manual amount" vs "Automatic (tier rates)" label.
   */
  payIsManual: boolean;
  /** The bottom line for the viewed cleaner: base + tip share + parking share. */
  totalEmployeePay: number;
  isLead: boolean;
  // Tier-based pay context (src/lib/pay-tiers.ts)
  tier: "TRAINEE" | "STANDARD" | "FIELD_LEAD";
  /** Effective fraction of job price = tier base × multiplier. 0 when the
   *  percentage model doesn't apply (FLAT / HOURLY / manual override). */
  individualRate: number;
  isSplit: boolean; // true when 2+ cleaners are on the job (each paid their own rate)
  poolTotal: number; // total cleaner cost of the job (sum of every cleaner's pay)
};

export type PayBreakdown = CleanerPayBreakdown | AdminPayBreakdown;

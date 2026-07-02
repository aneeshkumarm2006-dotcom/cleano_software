export type PayBreakdown = {
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
  isSplit: boolean; // true when 2+ cleaners share the 50% pool
  poolTotal: number; // combined pay pool for the job
};

export type IncomeData = {
  year: number;
  /** Gross (base) of PAID payouts for work performed in `year`. */
  grossYTD: number;
  /** Net of PAID payouts for work performed in `year`. */
  netYTD: number;
  /** Net paid + everything still pending for work performed in `year`. */
  earnedYTD: number;
  deductionsYTD: number;
  adjustmentsYTD: number;
  reimbursementsYTD: number;
  /** Rough estimate only — never presented as an authoritative rate. */
  estimatedTaxes: number;
  estimatedTaxRate: number;
  totalHoursYTD: number;
  /** All completed/paid jobs in `year`, not just those inside PAID periods. */
  jobsCompletedYTD: number;
  paidPayoutCount: number;
  pendingAmount: number;
  withdrawnYTD: number;
};

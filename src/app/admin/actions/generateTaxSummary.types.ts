export type TaxSummary = {
  documentNumber: string;
  generatedAt: string;
  year: number;
  employee: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
  };
  grossIncome: number;
  netIncome: number;
  totalDeductions: number;
  totalAdjustments: number;
  totalReimbursements: number;
  estimatedTaxes: number;
  estimatedTaxRate: number;
  totalHours: number;
  jobsCompleted: number;
  payPeriods: Array<{
    payoutId: string;
    periodStart: string;
    periodEnd: string;
    paidAt: string | null;
    baseAmount: number;
    adjustments: number;
    deductions: number;
    reimbursements: number;
    finalAmount: number;
    jobCount: number;
    totalHours: number;
  }>;
};

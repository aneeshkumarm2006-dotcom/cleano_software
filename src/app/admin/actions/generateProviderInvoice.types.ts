export type ProviderInvoiceLine = {
  payoutId: string;
  periodStart: string;
  periodEnd: string;
  jobCount: number;
  totalHours: number;
  baseAmount: number;
  adjustments: number;
  deductions: number;
  reimbursements: number;
  finalAmount: number;
  status: string;
  paidAt: string | null;
};

export type ProviderInvoice = {
  invoiceNumber: string;
  generatedAt: string;
  employee: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
  };
  periodFrom: string | null;
  periodTo: string | null;
  lines: ProviderInvoiceLine[];
  subtotal: number;
  totalHours: number;
  totalJobs: number;
};

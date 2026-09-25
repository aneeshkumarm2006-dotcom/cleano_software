export interface JobExportRow {
  Date: string;
  Client: string;
  Employee: string;
  Location: string;
  "Job Type": string;
  Status: string;
  /** The ACTIVE value of the job — base + add-ons, or the override total. */
  Price: number | string;
  /** The raw service line, kept beside Price so the two reconcile (fix 3). */
  "Base Price": number | string;
  "Add-ons": number | string;
  Discount: number | string;
  "Employee Pay": number | string;
  Tip: number | string;
  Parking: number | string;
  "Payment Type": string;
  "Payment Received": string;
  "Invoice Sent": string;
  Bed: number | string;
  Bath: number | string;
}

// Payload for the pre-claim job preview (awerfixes.pdf item 8, round 3).
//
// ─── WHAT IS DELIBERATELY NOT IN HERE ──────────────────────────────────────
//
//   • `price` — the client price. Already withheld from the available-jobs
//     list for the same reason: a cleaner is told THEIR pay, never the
//     customer's bill. `estPay` below is the only money in this payload.
//   • `clientAddress.accessNotes` — door and gate codes. The job detail page
//     loads those behind a fail-closed assigned-cleaner guard; a preview is by
//     definition shown to someone who is NOT on the job yet. Address, yes;
//     the way in, only after claiming.
//   • `client.phone` / `client.email` — same reasoning, plus the
//     `provider.showCustomerPhone` setting gates the phone even for assigned
//     cleaners.
//
// Adding any of the above to this type is a privacy regression, not a feature.

export interface PreviewAddOn {
  name: string;
  /** Always >= 1; clamped through addOnQuantity() (src/lib/job-money.ts). */
  quantity: number;
}

export interface PreviewChecklistTemplate {
  name: string;
  itemCount: number;
  requiredCount: number;
}

export interface AvailableJobPreview {
  id: string;
  jobNumber: number;
  clientName: string;
  /** ISO. */
  startTime: string;
  isFlexible: boolean;

  /** Resolved through the admin's own service names, never the raw column. */
  serviceType: string | null;

  /** Full street + unit, formatted by formatAddressLine. */
  address: string | null;

  /**
   * Apartment/condo vs house (Stage 9 / PDF #11), or null when unrecorded.
   * Property information a cleaner weighs before claiming — it is not money and
   * not a way in, so it belongs on this side of the line above.
   */
  propertyType: string | null;

  bedCount: number | null;
  bathCount: number | null;
  halfBathCount: number | null;
  squareFootage: number | null;

  addOns: PreviewAddOn[];

  /** Billing text already stripped by sanitizeCleanerNotes. */
  notes: string | null;

  /**
   * endTime − startTime, in minutes. Null when the job has no endTime — which
   * is common, because the public booking flow never sets one and there is no
   * per-jobType default anywhere in this codebase to fall back to. The UI says
   * "Set by dispatch" rather than inventing a figure.
   */
  durationMinutes: number | null;

  /**
   * Templates that WOULD produce a checklist for this job, matched with the
   * same rule generation uses. Read-only: no JobChecklist row is created by
   * previewing.
   */
  checklistTemplates: PreviewChecklistTemplate[];

  /** This cleaner's estimated payout on PERCENTAGE jobs. */
  estPay: number | null;
  /** Rate on HOURLY jobs. */
  estHourly: number | null;
  payType: string;

  requiredCleaners: number;
  claimedCount: number;
}

export type AvailableJobPreviewResult =
  | { success: true; preview: AvailableJobPreview }
  | { success: false; error: string };

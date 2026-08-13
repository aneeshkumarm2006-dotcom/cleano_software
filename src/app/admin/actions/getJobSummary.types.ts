import type { JobMoney } from "@/lib/job-money";

/**
 * The booking summary the calendar drawer renders (client feedback item 8).
 *
 * Shaped against the BookingKoala panel field list (OPEN-QUESTIONS Q2 §5):
 * header · booking details · money · notes. Deliberately a flat DTO of
 * PRIMITIVES + preformatted strings rather than a Prisma row:
 *
 *  • the calendar grid feeds itself *floating* store wall-clock strings
 *    (getJobsForDay → toBusinessWallClock) so browser-local reads show store
 *    time — but this action returns real instants, so every human-readable
 *    date/time here is formatted SERVER-side through STORE_TZ. Handing the
 *    drawer a Date and letting it call toLocaleString() would print the
 *    viewer's timezone, and the two surfaces would disagree on the same job.
 *  • `startTimeIso` / `endTimeIso` survive raw because JobModal's edit prefill
 *    parses them itself (tzInputParts).
 */
export type JobSummaryDTO = {
  id: string;
  jobNumber: number;
  status: string;
  /** Raw stored jobType code; `serviceLabel` is the resolved display name. */
  jobType: string | null;
  serviceLabel: string;
  description: string | null;

  // ── When ──────────────────────────────────────────────────────────────────
  /** Real instant, for JobModal's edit prefill. Never rendered directly. */
  startTimeIso: string;
  endTimeIso: string | null;
  /** "Wed, Aug 12, 2026" — STORE_TZ. */
  dateLabel: string;
  /** "9:30 AM – 12:30 PM" — STORE_TZ. */
  timeLabel: string;
  /** "3h" — null when the job has no end time. */
  durationLabel: string | null;

  // ── Who ───────────────────────────────────────────────────────────────────
  clientName: string;
  clientId: string | null;
  clientEmail: string | null;
  clientPhone: string | null;

  // ── Where ─────────────────────────────────────────────────────────────────
  location: string | null;
  aptNumber: string | null;
  postalCode: string | null;
  clientAddressId: string | null;
  /** `formatAddressLine` output — street, unit and postal on one line. */
  addressLine: string;

  // ── Booking details ───────────────────────────────────────────────────────
  /** "One-time" · "Recurring · visit 3 of 12". */
  frequencyLabel: string;
  isRecurring: boolean;
  requiredCleaners: number;
  bedCount: number | null;
  bathCount: number | null;
  halfBathCount: number | null;
  squareFootage: number | null;
  cleaners: { id: string; name: string; status: string | null; pay: number | null }[];
  leadEmployee: { id: string; name: string } | null;

  // ── Money ─────────────────────────────────────────────────────────────────
  money: JobMoney;
  /**
   * RAW `Job.price` / `Job.discountAmount` / `Job.taxExempt`, for the edit
   * modal's prefill — deliberately not read off `money`. `money.basePrice` is a
   * display residual on web/BookingKoala bookings (`subtotal − addOns`), and
   * `money.exempt` is `isCashJob || taxExempt`, so seeding the form from either
   * would rewrite the stored value on the next save.
   */
  price: number | null;
  discountAmount: number | null;
  discountReason: string | null;
  taxExempt: boolean;
  paymentType: string | null;
  isCashJob: boolean;
  paymentReceived: boolean;
  invoiceSent: boolean;
  /** "Paid Aug 12" / null. */
  paidAtLabel: string | null;
  depositPaid: boolean;
  refundedAmount: number;
  tipAmount: number;
  totalTip: number | null;
  /** `Job.parking`, surfaced as "Transportation" (Stage 4 item 3). */
  transportation: number | null;
  employeePay: number | null;
  payType: string | null;
  hourlyRate: number | null;
  hasCardOnFile: boolean;

  // ── Rest ──────────────────────────────────────────────────────────────────
  notes: string | null;
  cancellationReason: string | null;
  photoCount: number;
  bookingSource: string | null;
};

export type JobSummaryResult =
  | { success: true; job: JobSummaryDTO }
  | { success: false; error: string };

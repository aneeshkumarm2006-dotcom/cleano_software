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
  /**
   * Why this job is on hold (round 4, fix 6). Non-null only when `status` is
   * CREATED. The calendar drawer prints it and offers the Release button beside
   * it — a held booking clicked on the calendar was previously an unexplained
   * grey block with no action at all.
   */
  holdReason: string | null;
  /**
   * Quote lifecycle (Stage 11 / PDF #9); null on every non-quote booking. The
   * drawer reads it to decide whether a hold is releasable here or belongs to
   * the Quote review panel on the full job page (round 4, fix 6).
   */
  quoteStatus: string | null;
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
  /**
   * Apartment/condo vs house (Stage 9 / PDF #11), or null when unrecorded.
   * Load-bearing twice, like the billing columns below: the drawer prints it,
   * and the drawer's Edit button seeds JobModal from this DTO — without it the
   * modal would open on "Not specified" and erase the job's type on save.
   */
  propertyType: string | null;
  /** Pinned checklist template (Stage 10). Null = resolve automatically. */
  checklistTemplateId: string | null;
  cleaners: { id: string; name: string; status: string | null; pay: number | null }[];
  leadEmployee: { id: string; name: string } | null;

  // ── Money ─────────────────────────────────────────────────────────────────
  money: JobMoney;
  /**
   * What this job's card would actually be charged right now — `resolveAmountDue`,
   * i.e. the stored taxed total less any deposit already collected (fix 3 item
   * 3.2). Deliberately NOT `money.totalAmount`: the drawer prints this beside a
   * "Charge card" button, and a booking with a $20 deposit paid owes $20 less
   * than its total. Gift-card credit is applied by `chargeJob` at charge time
   * against the client's live balance and is not reflected here.
   */
  amountDue: number;
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
  /**
   * What the deposit actually was (Stage 11 / PDF #9). Null on rows written
   * before the column — all of which charged the standard $20.
   */
  depositAmount: number | null;
  refundedAmount: number;
  tipAmount: number;
  totalTip: number | null;
  /** `Job.parking`, surfaced as "Transportation" (Stage 4 item 3). */
  transportation: number | null;
  employeePay: number | null;
  /** D2 — TRUE when employeePay is a manual team total, not an estimate. */
  employeePayIsManual: boolean;
  payType: string | null;
  hourlyRate: number | null;
  /**
   * Customer-side hourly billing (Stage 8 / PDF #8) — how the CUSTOMER is
   * charged, never to be read together with `payType`/`hourlyRate` above, which
   * are how the CLEANER is paid. `money.hourlyServiceAmount` carries the
   * resulting `rate × hours` figure.
   */
  billingType: string;
  billedHourlyRate: number | null;
  billedEstimatedHours: number | null;
  billedActualHours: number | null;
  hasCardOnFile: boolean;

  // ── Rest ──────────────────────────────────────────────────────────────────
  notes: string | null;
  cancellationReason: string | null;
  photoCount: number;
  bookingSource: string | null;
  /** Itemized vs final-price override (fix 2). */
  pricingMode: string | null;
};

export type JobSummaryResult =
  | { success: true; job: JobSummaryDTO }
  | { success: false; error: string };

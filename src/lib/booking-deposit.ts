// What a booking's deposit is worth (PDF #9, Stage 11).
//
// ## The bug this module exists to close
//
// The deposit used to be the literal number 20, written out in six places:
// `BOOKING_DEPOSIT_CENTS` in lib/stripe.ts, `BOOKING_DEPOSIT_USD` in
// job-billing.ts, and a bare `20` re-typed in issueRefund.ts,
// cancelJobByAdmin.ts, the admin job detail view and the customer portal. That
// was survivable while every booking paid the same $20. PDF #9 asks for a
// post-construction deposit of "example: $200", at which point every one of
// those literals becomes a refund that returns the wrong amount or an invoice
// that credits money the customer never paid.
//
// So: the amount charged is decided ONCE, server-side, per service type, and
// then STORED on the job (`Job.depositAmount`). Every downstream reader uses the
// stored figure — `resolveDepositCredit` below — and never re-derives it, because
// the setting can be edited after a booking is taken and a two-month-old job
// must still credit what it actually collected.
//
// PURE — no DB, no framework. `charge-deposit` (a route), `submitBooking` (an
// action), the review step (a client component) and the refund paths all read
// from here, so this file must import nothing that any of them can't.
//
// The DOLLAR amounts live here; `booking-deposit.server.ts` is the only place
// that reads the admin setting.

/**
 * The DEFAULT standard deposit, in dollars. Equals `BOOKING_DEPOSIT_CENTS / 100`
 * in lib/stripe.ts, which is still the constant the Stripe layer works in.
 *
 * It used to be the only answer — "regular bookings keep the $20", hardcoded.
 * That held while one company used the product. It cannot hold across many:
 * $20 is a meaningful deposit on a $200 flat and a rounding error on a
 * post-construction site, and every company prices differently. So this is now
 * the default behind `STANDARD_DEPOSIT_SETTING_KEY`, and an untouched workspace
 * behaves exactly as before.
 */
export const STANDARD_BOOKING_DEPOSIT_USD = 20;

/** Registry key for the deposit every non-quoted service charges. */
export const STANDARD_DEPOSIT_SETTING_KEY = "booking.standardDepositUsd";

/**
 * Bounds on the configured standard deposit.
 *
 * Zero is allowed, and it is not a neutral choice. In the guest booking flow
 * the captured deposit is what stands in for authentication — it is the reason
 * a stranger cannot mint unlimited real jobs from the public page. A workspace
 * that sets this to 0 is choosing to take bookings with no barrier at all, so
 * the settings copy says so rather than leaving it to be discovered.
 *
 * The ceiling is a fat-finger guard, not a policy: a mistyped 5000 should be
 * refused here rather than by a chargeback.
 */
export const STANDARD_DEPOSIT_MIN_USD = 0;
export const STANDARD_DEPOSIT_MAX_USD = 500;

/** Registry key for the post-construction deposit. Default 200 (PDF #9). */
export const PC_DEPOSIT_SETTING_KEY = "booking.postConstructionDepositUsd";

export const PC_DEPOSIT_DEFAULT_USD = 200;

/**
 * Bounds on the configured post-construction deposit. The upper bound is a
 * guard-rail, not a policy: the deposit is charged to a card before anyone has
 * seen the space, so a fat-fingered 20000 must be refused by the registry
 * rather than by a chargeback.
 */
export const PC_DEPOSIT_MIN_USD = 0;
export const PC_DEPOSIT_MAX_USD = 2000;

/**
 * Is this service type quoted after photo review rather than priced instantly?
 *
 * Post-construction only, and the string is the booking flow's own
 * `SERVICE_TYPES` value — the same test `isHourlyService` in service-pricing.ts
 * makes, kept separate because these two facts are independent: a future service
 * could be quoted without being hourly, or hourly without being quoted.
 */
export function isQuotedService(serviceType?: string | null): boolean {
  return serviceType === "POST_CONSTRUCTION";
}

/**
 * The deposit to CHARGE for a new booking of this service.
 *
 * `pcDepositUsd` is the configured post-construction amount, read by the caller
 * through `loadPcDepositUsd()`. Passed in rather than read here so this module
 * stays pure and so the amount is resolved exactly once per booking, server-side
 * — never from the client, which is the whole point (a client-supplied deposit
 * is a self-service discount on the only payment that proves a booking is real).
 */
export function depositUsdForService(
  serviceType: string | null | undefined,
  pcDepositUsd: number,
  // Defaulted so every existing caller keeps its exact previous behaviour; the
  // two server paths that resolve settings pass the configured figure.
  standardDepositUsd: number = STANDARD_BOOKING_DEPOSIT_USD
): number {
  if (!isQuotedService(serviceType)) {
    const std = Number(standardDepositUsd);
    if (!Number.isFinite(std) || std < 0) return STANDARD_BOOKING_DEPOSIT_USD;
    return Math.round(std * 100) / 100;
  }
  const n = Number(pcDepositUsd);
  if (!Number.isFinite(n) || n < 0) return PC_DEPOSIT_DEFAULT_USD;
  return Math.round(n * 100) / 100;
}

/** The same figure in cents, which is the unit Stripe intents are created in. */
export function depositCentsForService(
  serviceType: string | null | undefined,
  pcDepositUsd: number,
  standardDepositUsd: number = STANDARD_BOOKING_DEPOSIT_USD
): number {
  return Math.round(depositUsdForService(serviceType, pcDepositUsd, standardDepositUsd) * 100);
}

/** The `metadata.kind` stamped on the PaymentIntent, per service type. */
export function depositIntentKind(serviceType?: string | null): string {
  return isQuotedService(serviceType) ? "pc_deposit" : "booking_deposit";
}

/**
 * Every `metadata.kind` that counts as a booking deposit when a PaymentIntent is
 * verified. `booking_deposit` is the pre-Stage-11 value and must keep verifying
 * — intents in flight during a deploy carry it — and `pc_deposit` is the new one.
 * Anything else (a gift-card purchase, a job charge, a cancellation fee) is NOT
 * a deposit and must never mint a paid booking.
 */
export const DEPOSIT_INTENT_KINDS: readonly string[] = [
  "booking_deposit",
  "pc_deposit",
] as const;

export function isDepositIntentKind(v: unknown): boolean {
  return typeof v === "string" && DEPOSIT_INTENT_KINDS.includes(v);
}

/** The columns any deposit calculation reads. Both optional — see below. */
export interface DepositCreditFields {
  depositPaid: boolean;
  /** What was actually charged. NULL on rows written before Stage 11. */
  depositAmount?: number | null;
}

/**
 * THE deposit credit for a job: what it actually collected, or nothing.
 *
 * `depositAmount ?? STANDARD_BOOKING_DEPOSIT_USD` is not a guess — every booking
 * that predates this column charged exactly $20 (it was a hardcoded constant),
 * so the fallback is the historically correct figure and this function returns
 * byte-identical answers on every existing row. New bookings store what they
 * charged, so a $200 post-construction deposit credits $200.
 *
 * Guarded on `depositPaid` first, which `submitBooking` only stamps after
 * `verifyBookingDeposit` confirms the intent with Stripe — so an unpaid booking
 * can never credit itself.
 */
export function resolveDepositCredit(job: DepositCreditFields): number {
  if (!job.depositPaid) return 0;
  const n = Number(job.depositAmount);
  if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  return STANDARD_BOOKING_DEPOSIT_USD;
}

/** "$200.00" — one formatter, so no two surfaces round the deposit differently. */
export function formatDeposit(usd: number): string {
  return `$${(Number.isFinite(usd) ? usd : 0).toFixed(2)}`;
}

/* ---------------------------- booking photos (11.3) ----------------------- */
//
// PDF #9: "the client uploads pictures of the space during booking". The bounds
// live here rather than in the upload action because the /book dropzone, the
// step gate and the server-side clamp in `submitBooking` all have to agree — a
// UI that allows ten and a server that accepts three is a customer who paid a
// $200 deposit and then lost their photos.

export const BOOKING_PHOTO_MIN = 2;
export const BOOKING_PHOTO_MAX = 10;
export const BOOKING_PHOTO_MAX_BYTES = 10 * 1024 * 1024; // 10 MB, as uploadJobPhoto

export const BOOKING_PHOTO_MIME_TYPES: readonly string[] = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
] as const;

/**
 * Cloudinary folder every booking-time photo lands in.
 *
 * It is also the trust boundary: `submitBooking` accepts a photo URL only if it
 * points inside this folder on our own cloud (see `isBookingPhotoUrl`), so the
 * public action cannot be used to attach an arbitrary internet image — or an
 * asset from another job's folder — to a job record.
 */
export const BOOKING_PHOTO_FOLDER = "cleano/booking-uploads";

/**
 * Does this URL look like something OUR upload action produced?
 *
 * Both halves matter. The cloud name pins it to our account, so a URL from
 * anyone else's Cloudinary is refused; the folder pins it to the public booking
 * uploader, so a link to `cleano/jobs/<someone-elses-job>/…` — which is a real,
 * fetchable URL on our cloud — cannot be attached either.
 */
export function isBookingPhotoUrl(
  url: unknown,
  cloudName: string | undefined
): boolean {
  if (typeof url !== "string" || !cloudName) return false;
  if (url.length > 2048) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.hostname !== "res.cloudinary.com") return false;
  // /<cloud>/image/upload/…/cleano/booking-uploads/<id>
  if (!parsed.pathname.startsWith(`/${cloudName}/`)) return false;
  return parsed.pathname.includes(`/${BOOKING_PHOTO_FOLDER}/`);
}

/** The caption stored on a photo the customer uploaded at booking time. */
export const BOOKING_PHOTO_CAPTION = "Uploaded by the customer at booking";

/**
 * What to show where a photo's uploader would go when there isn't one.
 *
 * `JobPhoto.employeeId` is nullable from Stage 11 and NULL means "the customer
 * did this from /book". One label, in one place, because four galleries print it
 * (admin job detail, the calendar modal, the cleaner gallery, the quote panel) and
 * "Unknown" in any of them would read as a data problem rather than as the
 * ordinary, expected case it is.
 */
export const BOOKING_PHOTO_UPLOADER_LABEL = "Customer (at booking)";

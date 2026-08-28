"use server";

import { db } from "@/lib/org-db";
import { checkServiceAreaInternal } from "@/lib/service-area";
import { getBlockedDates, isTimeBlocked } from "@/lib/blocked-dates";
import { getBookingConfig } from "./getBookingConfig";
import { BOOKING_DAY_START, BOOKING_DAY_END } from "../book/types";
import {
  computeBookingPrice,
  nextOccurrence,
  recurrenceCount,
  recurringDiscountPercent,
} from "@/lib/booking-pricing";
import {
  ensureClientReferralCode,
  generateUniqueReferralCode,
} from "@/lib/referral";
import { getSetting } from "@/lib/settings";
import {
  BOOKING_PAGE_CONFIG_KEY,
  frequencyEnabled,
} from "@/lib/booking-page-config";
import { addOnQuantity, MAX_ADDON_QUANTITY } from "@/lib/job-money";
import { advanceContactLifecycleForBooking, logContactEvent } from "@/lib/crm";
import {
  sendBookingConfirmation,
  sendAdminNewBookingNotification,
  sendCustomerBookingsPrepaid,
} from "@/lib/email";
import { isValidEmail, isValidPhone } from "@/lib/validation";
import { AFTER_PHOTO_CONSENT_VERSION } from "@/lib/policy";
import { BOOKING_DEPOSIT_CURRENCY } from "@/lib/stripe";
import { requireStripeForCurrentOrg } from "@/lib/stripe-org";
import {
  BOOKING_PHOTO_CAPTION,
  BOOKING_PHOTO_MAX,
  BOOKING_PHOTO_MIN,
  formatDeposit,
  isBookingPhotoUrl,
  isDepositIntentKind,
  isQuotedService,
} from "@/lib/booking-deposit";
import { resolveDepositUsdForService } from "@/lib/booking-deposit.server";
// `isAwaitingQuote` — not a bare PENDING_REVIEW test — on the three retry paths
// below. A resubmit can land after an admin has already sent the quote, and
// "QUOTED" is still not a confirmed cleaning: the confirmation screen must not
// promise one.
import { isAwaitingQuote } from "@/lib/quote-status";
import { HOLD_REASON } from "@/lib/job-hold";
import { logActivity } from "@/lib/activity-log";
import { applyPromoCode } from "./applyPromoCode";
import { formatAddressLine } from "@/lib/client-address";
import { resolveJobAddressId } from "@/lib/client-address-store";
import { parsePropertyType } from "@/lib/property-type";
import { allocateJobNumber } from "@/lib/job-number";
import { requireOrgId } from "@/lib/org";
import { bookingPhotoFolderFor, currentOrgSlug } from "@/lib/asset-folder";

type Frequency =
  | "ONE_TIME"
  | "WEEKLY"
  | "BIWEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "TWICE_WEEKLY"
  | "HIGH_FREQUENCY";

interface SubmitBookingInput {
  // Step 1
  postalCode: string;
  // Step 2
  address: string;
  /** Unit / buzzer number (item 2). Optional — /book never captured one before. */
  aptNumber?: string;
  /**
   * A saved ClientAddress the customer picked. UNTRUSTED: this action is public
   * and identity here comes from the verified deposit + email, never a session,
   * so the id is re-checked against the resolved client before it is used —
   * exactly the reasoning applied to the Stripe ids above.
   */
  addressId?: string | null;
  /**
   * Apartment/condo vs house (Stage 9 / PDF #11). Optional, and UNTRUSTED like
   * everything else on this public action: it is re-parsed through
   * `parsePropertyType` below, so an unrecognised string lands as null rather
   * than reaching the column. Prices nothing - `computeBookingPrice` never
   * sees it.
   */
  propertyType?: string | null;
  bedCount: number;
  bathCount: number;
  halfBathCount: number;
  squareFootage: number;
  serviceType: string;
  pcHours?: number; // post-construction hours (drives hourly pricing)
  pcCleaners?: number; // post-construction crew size (× hourly)
  /**
   * Photos of the space the customer uploaded during step 2 (PDF #9, Stage 11).
   *
   * URLs, not files: `uploadBookingPhoto` already put them in storage, because
   * the job they attach to does not exist until this action runs. UNTRUSTED like
   * everything else here — every one is re-checked with `isBookingPhotoUrl`
   * against our own cloud and our own upload folder, so this cannot be used to
   * staple an arbitrary internet image (or another job's photo) onto a job row.
   */
  photoUrls?: string[];
  frequency: Frequency;
  // Client sends id (preferred) and/or name; the price is resolved server-side
  // from the catalog and any client-supplied price is ignored. `quantity` IS
  // taken from the client, so it is clamped and coalesced below.
  addOns: { id?: string; name: string; price?: number; quantity?: number }[];
  // Step 3
  date: string; // YYYY-MM-DD
  isFlexible: boolean;
  timeSlot: string; // "HH:mm" or "" if flexible
  // Step 4
  name: string;
  phone: string;
  email: string;
  notes: string;
  referralCode: string;
  afterPhotoConsent?: boolean;
  smsConsent?: boolean;
  promoCode?: string;
  // NOTE: no `promoDiscount`. The discount figure is re-derived server-side
  // from the catalog — accepting it from the client is how a discount becomes
  // self-service.
  // Optional
  leadId?: string;
  // The deposit PaymentIntent, created by /api/stripe/charge-deposit and
  // confirmed in the browser before this action runs. REQUIRED: it is verified
  // against Stripe below and is what proves the booking was actually paid for.
  //
  // The Stripe customer and payment-method ids are deliberately NOT accepted
  // from the client. They are read off the verified PaymentIntent instead, so a
  // crafted request can't point a client record at someone else's card.
  depositPaymentIntentId?: string;
}

/** Shape returned by `verifyBookingDeposit` on success. */
interface VerifiedDeposit {
  paymentIntentId: string;
  stripeCustomerId: string;
  stripePaymentMethodId: string | null;
  /**
   * What Stripe says was ACTUALLY captured, in dollars — `amount_received`, not
   * the figure we asked for (Stage 11).
   *
   * This is what lands in `Job.depositAmount`, and therefore what gets credited
   * at completion and capped at refund time. Reading the charge rather than the
   * request means the credit can never exceed the money: if a customer paid the
   * $200 post-construction deposit and then switched to a standard clean, they
   * are credited the $200 they really paid, not the $20 that service asks for.
   */
  amountUsd: number;
}

/**
 * `already_used` is not a failure — the deposit intent is the natural
 * idempotency key for a booking, so a retry that presents the same intent gets
 * the job it already paid for rather than an error or a second job.
 */
/**
 * What a booking records about payment, once the deposit question is settled.
 *
 * Every field is nullable because a workspace may charge no deposit at all, and
 * then there is no intent, no Stripe customer and no saved card. Writing empty
 * strings instead would be worse than wrong: Client.stripeCustomerId is UNIQUE,
 * so the second no-deposit booking would collide with the first.
 */
interface DepositOutcome {
  paymentIntentId: string | null;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
  amountUsd: number;
}

type DepositVerification =
  | { status: "ok"; deposit: VerifiedDeposit }
  | { status: "waived" }
  | { status: "rejected"; error: string }
  | { status: "already_used"; jobId: string };

/**
 * Proves a booking deposit was genuinely paid, for this booking, exactly once.
 *
 * `submitBooking` is a PUBLIC, unauthenticated server action — the browser's
 * "you must add a card" gate is cosmetic and a crafted request bypasses it
 * entirely. Everything downstream that spends money keys off what we write
 * here: `depositPaid` drives the refund amount, and `depositPaymentIntentId`
 * is the refund TARGET, so an unverified id here means a refund can be issued
 * against a stranger's charge.
 *
 * Each check below closes a specific hole; see the inline notes.
 */
async function verifyBookingDeposit(
  paymentIntentId: unknown,
  bookingEmail: string,
  existingStripeCustomerId: string | null,
  /**
   * What THIS booking's deposit must be, in cents — resolved server-side from the
   * service type being booked (Stage 11). Passed in rather than read from a
   * constant, because a post-construction booking owes $200 and a $20 intent must
   * not satisfy it. Getting this wrong is not a cosmetic bug: the deposit is the
   * only thing standing in for authentication in the guest flow.
   */
  requiredCents: number
): Promise<DepositVerification> {
  const GENERIC =
    "We couldn't verify your deposit payment. Please try again, or contact us if the problem continues.";

  // (1) Shape-check before spending a Stripe round-trip on obvious garbage.
  if (
    typeof paymentIntentId !== "string" ||
    !/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId)
  ) {
    return { status: "rejected", error: GENERIC };
  }

  // (2) Must actually exist under OUR key. A forged or test-mode id 404s here.
  let pi;
  try {
    pi = await (await requireStripeForCurrentOrg()).paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    });
  } catch {
    return { status: "rejected", error: GENERIC };
  }

  // (3) Only a succeeded intent is paid. requires_payment_method / canceled /
  // requires_capture are all "not paid".
  if (pi.status !== "succeeded") {
    return { status: "rejected", error: GENERIC };
  }

  // (4) amount_received, NOT amount — `amount` is only the intent, and proves
  // nothing was actually captured. The floor is THIS booking's deposit, not a
  // constant (Stage 11): the old `>= BOOKING_DEPOSIT_CENTS` would have accepted a
  // $20 intent for a $200 post-construction quote, which is the whole deposit
  // requirement bypassed by editing one field in the browser.
  if ((pi.amount_received ?? 0) < requiredCents) {
    return { status: "rejected", error: GENERIC };
  }

  // (5) Blocks a deposit denominated in a weaker currency.
  if (pi.currency !== BOOKING_DEPOSIT_CURRENCY) {
    return { status: "rejected", error: GENERIC };
  }

  // (6) Must be a BOOKING DEPOSIT. Without this, any succeeded intent the payer
  // legitimately owns — a gift-card purchase (kind: "gift_card"), a job charge,
  // a cancellation fee — could be replayed here to mint a "paid" booking, and
  // would then become the refund target. `type` is accepted alongside the newer
  // `kind` so intents created before this shipped still verify.
  //
  // Both deposit kinds are accepted (`booking_deposit`, `pc_deposit`) rather than
  // requiring the one matching this service: the KIND is a reporting label, and
  // the amount check above is what actually holds a post-construction booking to
  // its $200. Pinning the kind as well would reject a customer who legitimately
  // switched service type between paying and submitting, whose intent is worth
  // MORE than the booking now needs.
  const isDeposit =
    isDepositIntentKind(pi.metadata?.kind) || pi.metadata?.type === "deposit";
  if (!isDeposit) {
    return { status: "rejected", error: GENERIC };
  }

  // (7) Bind the payment to the email being booked. This is the only identity
  // binding available in a guest flow. Enforced only when present: intents
  // created before this shipped carry no email, and rejecting those would fail
  // real customers mid-checkout during a deploy. New intents always carry it.
  const piEmail = pi.metadata?.email;
  if (piEmail && piEmail !== bookingEmail) {
    return { status: "rejected", error: GENERIC };
  }

  // (8) A livemode mismatch means a misconfigured key — fail loudly rather than
  // accept a test-mode payment as real money.
  const expectLive = !!process.env.STRIPE_SECRET_KEY?.startsWith("sk_live");
  if (pi.livemode !== expectLive) {
    return { status: "rejected", error: GENERIC };
  }

  // (9) Blocks pay → refund → replay.
  const charge = typeof pi.latest_charge === "string" ? null : pi.latest_charge;
  if (charge && (charge.refunded || (charge.amount_refunded ?? 0) > 0)) {
    return { status: "rejected", error: GENERIC };
  }

  // (10) Bounds how far back an intent can be resurrected. Generous, because a
  // customer can legitimately leave the review step open for a while.
  const ageMs = Date.now() - pi.created * 1000;
  if (ageMs > 24 * 60 * 60 * 1000) {
    return { status: "rejected", error: GENERIC };
  }

  // (11) The customer must be resolvable, and must match the client's existing
  // Stripe customer when they have one — blocks cross-customer intent reuse.
  const stripeCustomerId =
    typeof pi.customer === "string" ? pi.customer : (pi.customer?.id ?? null);
  if (!stripeCustomerId) {
    return { status: "rejected", error: GENERIC };
  }
  if (existingStripeCustomerId && stripeCustomerId !== existingStripeCustomerId) {
    return { status: "rejected", error: GENERIC };
  }

  // (12) Anti-replay. The real fix is a UNIQUE index on
  // Job.depositPaymentIntentId (migration pending) — this lookup closes casual
  // reuse but not two concurrent requests racing on the same intent.
  const alreadyUsed = await db.job.findFirst({
    where: { depositPaymentIntentId: paymentIntentId },
    select: { id: true },
  });
  if (alreadyUsed) {
    return { status: "already_used", jobId: alreadyUsed.id };
  }

  // The payment method is read off the verified intent — never from the client.
  // charge-deposit sets setup_future_usage: "off_session", so on success the
  // card is already attached to the customer and is safe to make the default.
  const stripePaymentMethodId =
    typeof pi.payment_method === "string"
      ? pi.payment_method
      : (pi.payment_method?.id ?? null);

  return {
    status: "ok",
    deposit: {
      paymentIntentId,
      stripeCustomerId,
      stripePaymentMethodId,
      amountUsd: Math.round(pi.amount_received ?? 0) / 100,
    },
  };
}

function parseStartTime(date: string, timeSlot: string, isFlexible: boolean): Date {
  // Defaults to 9am for flexible bookings — admin sets the real time later.
  const slot = isFlexible || !timeSlot ? "09:00" : timeSlot;
  return new Date(`${date}T${slot}:00`);
}

/** Add whole days to a YYYY-MM-DD string (UTC arithmetic, DST-safe). */
function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export async function submitBooking(input: SubmitBookingInput) {
  try {
    // 1. Validate basics
    const email = input.email?.trim().toLowerCase();
    if (!email || !isValidEmail(email)) {
      return { success: false, error: "Valid email is required" };
    }
    if (!input.name?.trim()) {
      return { success: false, error: "Name is required" };
    }
    if (!input.phone?.trim() || !isValidPhone(input.phone)) {
      return { success: false, error: "Valid phone number is required" };
    }
    if (!input.address?.trim()) {
      return { success: false, error: "Address is required" };
    }
    if (!input.date) {
      return { success: false, error: "Date is required" };
    }

    // Server-side lead-time guard (#72). The date picker greys out too-soon
    // dates, but a crafted request could bypass it. "Today" is computed in the
    // store timezone so an evening booking isn't falsely rejected by UTC skew.
    const minLeadDays = await getSetting("scheduling.minLeadDays");
    const storeTimezone = await getSetting("general.timezone");
    const leadDays = Math.max(1, minLeadDays);
    const todayStore = new Intl.DateTimeFormat("en-CA", {
      timeZone: storeTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const earliest = addDays(todayStore, leadDays);
    if (input.date < earliest) {
      return {
        success: false,
        error: `Bookings must be at least ${leadDays} day${
          leadDays === 1 ? "" : "s"
        } in advance. The earliest available date is ${earliest}.`,
      };
    }
    // Move-in/out is priced per square foot — require it.
    if (
      input.serviceType === "MOVE_IN_OUT" &&
      (!input.squareFootage || input.squareFootage <= 0)
    ) {
      return {
        success: false,
        error: "Square footage is required for move-in / move-out bookings.",
      };
    }

    // Item 15: services with no frequency choice are one-off prices with no
    // recurring discount (Move-in/out and Deep by default, admin-editable in
    // Settings → Booking Page). The form doesn't offer a frequency for them, so
    // a recurring value here can only come from a stale draft or a crafted
    // request — either way it would mint a whole unasked-for series at a
    // discount. Coerced rather than rejected: the booking itself is valid.
    const bookingPageCfg = await getSetting(BOOKING_PAGE_CONFIG_KEY);
    if (
      input.frequency !== "ONE_TIME" &&
      !frequencyEnabled(bookingPageCfg, input.serviceType)
    ) {
      input.frequency = "ONE_TIME";
    }

    // 1b. Reject fully-closed days (admin-configured). Server-authoritative —
    // the date picker greys these out but a crafted request could bypass it.
    const blockedDates = await getBlockedDates();
    if (blockedDates.includes(input.date)) {
      return {
        success: false,
        error: "Sorry, we're closed on that date. Please choose another day.",
      };
    }
    // Reject a customer-chosen time that's outside business hours or inside an
    // admin-blocked window (skipped for flexible bookings, which don't pin a
    // time). Range-aware so an arbitrary time like "10:24" is validated too.
    if (!input.isFlexible && input.timeSlot) {
      if (
        input.timeSlot < BOOKING_DAY_START ||
        input.timeSlot > BOOKING_DAY_END
      ) {
        return {
          success: false,
          error: "Please choose a time between 9 AM and 7 PM.",
        };
      }
      const { blocked } = await isTimeBlocked(input.date, input.timeSlot);
      if (blocked) {
        return {
          success: false,
          error:
            "Sorry, that time is no longer available. Please choose another slot.",
        };
      }
    }

    // 2. Re-check service area (server-authoritative — client can be tampered)
    const areaCheck = await checkServiceAreaInternal(input.postalCode);
    if (!areaCheck.covered) {
      return {
        success: false,
        error: "Sorry, we don't service that postal code yet",
      };
    }

    // 3. Resolve referral code → referring client
    let referredByClientId: string | null = null;
    let referrerEligibleForCredit = false;
    if (input.referralCode?.trim()) {
      const referrer = await db.client.findUnique({
        where: { referralCode: input.referralCode.trim().toUpperCase() },
      });
      if (referrer) {
        referredByClientId = referrer.id;
        referrerEligibleForCredit = true;
      }
    }

    // 4. Upsert Client by email — auto-mint a referral code for new clients
    const existingClient = await db.client.findFirst({
      where: { email },
    });

    // ── Post-construction quote flow (PDF #9, Stage 11) ──────────────────────
    //
    // Resolved from the SERVICE TYPE, server-side, before anything is charged or
    // created. `isQuote` decides three things at once: how big the deposit has to
    // be, whether photos are mandatory, and whether the job is created as a quote
    // request instead of a booked cleaning.
    const isQuote = isQuotedService(input.serviceType);
    const requiredDepositUsd = await resolveDepositUsdForService(input.serviceType);

    // Photos. PDF #9: *"the client uploads pictures of the space"*. Validated
    // here rather than trusted, for two independent reasons — the URLs come from
    // the browser (so they are re-checked against our own upload folder), and the
    // COUNT is a business rule the step gate also enforces (so a crafted request
    // can't submit a photo-less quote request that an admin can never price).
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    // This company's own booking folder. With the single shared folder this
    // check used to allow a photo of ANOTHER company's customer's home: right
    // cloud, right folder, wrong company.
    const bookingFolder = bookingPhotoFolderFor(await currentOrgSlug());
    const photoUrls = Array.from(
      new Set(
        (Array.isArray(input.photoUrls) ? input.photoUrls : []).filter((u) =>
          isBookingPhotoUrl(u, cloudName, bookingFolder)
        )
      )
    ).slice(0, BOOKING_PHOTO_MAX);

    if (isQuote && photoUrls.length < BOOKING_PHOTO_MIN) {
      // Refused BEFORE the deposit is verified and BEFORE any row is written, so
      // a booking that can't be quoted never takes the customer's money. Worded
      // as something they can act on: the generic deposit error would send them
      // to support over a form field.
      return {
        success: false,
        error: `Please add at least ${BOOKING_PHOTO_MIN} photos of the space so we can quote your post-construction cleaning.`,
      };
    }

    // 4a. Verify the deposit BEFORE anything is created. This action is public
    // and unauthenticated, so without a mandatory verified deposit anyone can
    // POST it and mint unlimited real jobs (and, on a recurring frequency, a
    // whole series of them) for free. The verified payment is what stands in
    // for authentication in the guest booking flow.
    //
    // A workspace can set its deposit to zero, and then there is no payment to
    // verify. That is a real decision with a real cost: the verified deposit is
    // the ONLY thing standing between this public endpoint and a stranger
    // minting unlimited bookings, so the settings page says so in as many
    // words. What must never happen is the reverse — a workspace that DOES
    // charge a deposit accepting a booking without one — and that cannot happen
    // here, because the amount is re-resolved from the service type on the
    // server, never taken from the request.
    const depositDue = Math.round(requiredDepositUsd * 100) > 0;

    const verification: DepositVerification = depositDue
      ? await verifyBookingDeposit(
          input.depositPaymentIntentId,
          email,
          existingClient?.stripeCustomerId ?? null,
          Math.round(requiredDepositUsd * 100)
        )
      : { status: "waived" };
    if (verification.status === "rejected") {
      await logActivity({
        category: "DEPOSIT",
        action: "booking.deposit_rejected",
        status: "FAILED",
        actorLabel: "GUEST",
        message: `Rejected a booking attempt for ${email}: the deposit payment could not be verified.`,
        providerId:
          typeof input.depositPaymentIntentId === "string"
            ? input.depositPaymentIntentId
            : null,
        metadata: { email, hadPaymentIntent: !!input.depositPaymentIntentId },
      });
      return { success: false, error: verification.error };
    }

    // Retry of a booking that already went through on this deposit — hand back
    // the same job. Without this, a resubmit (flaky network, double submit)
    // would be rejected as a replay even though the customer did nothing wrong.
    if (verification.status === "already_used") {
      const existingJob = await db.job.findUnique({
        where: { id: verification.jobId },
        // `depositAmount`/`quoteStatus` too: this branch is a legitimate retry, so
        // the confirmation screen it lands on has to describe the job that really
        // exists — a quote request, with the deposit it really took.
        select: {
          id: true,
          price: true,
          depositAmount: true,
          quoteStatus: true,
        },
      });
      if (existingJob) {
        return {
          success: true,
          jobId: existingJob.id,
          childJobIds: [],
          total: existingJob.price ?? 0,
          depositAmount: existingJob.depositAmount ?? null,
          quotePending: isAwaitingQuote(existingJob.quoteStatus),
        };
      }
      // The job vanished between the two lookups (permanently deleted). Don't
      // create a second booking on a spent deposit.
      return {
        success: false,
        error:
          "This payment has already been used for a booking. Please contact us so we can help.",
      };
    }

    const deposit: DepositOutcome =
      verification.status === "ok"
        ? verification.deposit
        : { paymentIntentId: null, stripeCustomerId: null, stripePaymentMethodId: null, amountUsd: 0 };

    const isNewClient = !existingClient;
    const newReferralCode = isNewClient ? await generateUniqueReferralCode() : null;

    // Map Airbnb-specific frequencies to schema enum values (TWICE_WEEKLY / HIGH_FREQUENCY aren't in ServiceFrequency enum)
    type StoreFreq = "ONE_TIME" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY";
    const storeFrequency: StoreFreq | null =
      input.frequency === "TWICE_WEEKLY" || input.frequency === "HIGH_FREQUENCY"
        ? "WEEKLY"
        : (input.frequency as StoreFreq);

    const client = existingClient
      ? await db.client.update({
          where: { id: existingClient.id },
          data: {
            name: input.name.trim(),
            phone: input.phone.trim(),
            // `address` is deliberately NOT written here any more (item 2).
            //
            // This line used to clobber the returning customer's stored address
            // with whatever they typed for THIS booking, so booking a second
            // property permanently rewrote the first — and the portal's
            // "Default address" box with it. The address now goes to the
            // customer's address book below, where several can coexist.
            //
            // The create branch still seeds the scalar, because a brand-new
            // client has nothing to overwrite.
            serviceFrequency: storeFrequency,
            // Both ids come from the VERIFIED PaymentIntent, never from the
            // request body. Accepting them from the client let anyone repoint
            // any customer's default card by booking on their email address.
            //
            // Written only when there IS one. A workspace that charges no
            // deposit produces no Stripe customer, and assigning null here
            // would erase the id a returning customer already had — taking
            // their saved card with it.
            ...(deposit.stripeCustomerId && {
              stripeCustomerId: deposit.stripeCustomerId,
            }),
            ...(deposit.stripePaymentMethodId && {
              defaultPaymentMethodId: deposit.stripePaymentMethodId,
            }),
          },
        })
      : await db.client.create({
          data: {
            name: input.name.trim(),
            email,
            phone: input.phone.trim(),
            address: input.address.trim(),
            serviceFrequency: storeFrequency,
            referredByClientId,
            referralCode: newReferralCode,
            ...(deposit.stripeCustomerId && {
              stripeCustomerId: deposit.stripeCustomerId,
            }),
            ...(deposit.stripePaymentMethodId && {
              defaultPaymentMethodId: deposit.stripePaymentMethodId,
            }),
          },
        });

    // ── Address book (item 2) ────────────────────────────────────────────────
    // Every booking either links to a saved address the customer picked, or
    // adds the one they typed so it's offered next time. Before this stage
    // /book never touched ClientAddress at all — the admin side maintained a
    // book the customer could neither see nor add to.
    //
    // A picked id is honoured ONLY after being confirmed to belong to this
    // client: `client` is resolved from the verified deposit's email, while
    // `addressId` came from the browser.
    const bookingAddress = input.address.trim();
    const bookingApt = (input.aptNumber ?? "").trim() || null;
    // One rendering for every notification below, so the customer's
    // confirmation and the admin alert name the same door the cleaner is sent
    // to — the unit used to be missing from all of them.
    const bookingAddressLine = formatAddressLine({
      address: bookingAddress,
      aptNumber: bookingApt,
    });
    const clientAddressId = await resolveJobAddressId(client.id, {
      addressId: input.addressId ?? null,
      address: bookingAddress,
      aptNumber: bookingApt,
      // Step 1's postal code is finally persisted here. It was previously used
      // for the coverage check and then thrown away.
      postalCode: input.postalCode?.trim() || null,
      // Property size from step 2 (item 3), so the customer's own booking
      // teaches their address book what is at that door — the next booking, and
      // any admin booking on their behalf, arrives pre-filled. Blanks-only
      // inside `upsertClientAddress`: a customer under-stating their place on
      // one booking cannot overwrite what the address already records.
      //
      // `parsePropertyType` and not the raw string: `input.propertyType` is
      // untrusted browser input on a PUBLIC action, exactly like `addressId`
      // above, and anything unrecognised has to resolve to "not recorded"
      // rather than reach a column.
      propertyType: parsePropertyType(input.propertyType),
      bedCount: input.bedCount,
      bathCount: input.bathCount,
      halfBathCount: input.halfBathCount,
      squareFootage: input.squareFootage > 0 ? input.squareFootage : null,
    });

    // Backstop: make sure existing clients also have a code (for future shares).
    if (existingClient && !existingClient.referralCode) {
      await ensureClientReferralCode(client.id);
    }

    // Referral credit gating: only credit the referrer when a NEW client
    // makes their first booking, and there's no self-referral.
    if (
      !isNewClient ||
      !referrerEligibleForCredit ||
      referredByClientId === client.id
    ) {
      referrerEligibleForCredit = false;
    }

    // 5. Compute discount eligibility:
    //   - new client + valid referral code → first-booking discount
    //   - existing client + available credit → spend their balance (capped)
    let discountAmount = 0;
    let creditSpent = 0;

    if (isNewClient && referrerEligibleForCredit) {
      discountAmount = await getSetting("customer.newClientReferralDiscountUsd");
    } else if (!isNewClient && client.referralCredit > 0) {
      // Flat $50 absolute cap on credit spent per booking. NOTE: the comment
      // here used to read "up to 50% of subtotal", which this code has never
      // done — it never looks at the subtotal. Unlike the two amounts above,
      // this cap has no Settings key; adding one is tracked separately.
      creditSpent = Math.min(client.referralCredit, 50);
      discountAmount = creditSpent;
    }

    // 5a-bis. Resolve add-on prices server-side from the configured catalog.
    // Never trust prices from the client — they're tamperable (a negative price
    // could drag the whole booking to $0). Add-ons not in the catalog are dropped.
    //
    // The QUANTITY is the one number the client does supply, so it is clamped to
    // [1, MAX_ADDON_QUANTITY] and repeated entries for the same catalog row are
    // COALESCED rather than written as separate rows. Without the coalescing,
    // sending the same id fifty times was already an unbounded client-controlled
    // quantity — fifty rows at full price — which is the hole a real quantity
    // field has to close, not inherit.
    const { addOns: addOnCatalog } = await getBookingConfig();
    const addOnById = new Map(addOnCatalog.map((a) => [a.id, a]));
    const addOnByName = new Map(
      addOnCatalog.map((a) => [a.name.trim().toLowerCase(), a])
    );
    const addOnByKey = new Map<
      string,
      { name: string; price: number; quantity: number }
    >();
    for (const a of input.addOns ?? []) {
      const hit =
        (a.id && addOnById.get(a.id)) ||
        addOnByName.get((a.name ?? "").trim().toLowerCase());
      if (!hit) continue;
      const existing = addOnByKey.get(hit.id);
      const quantity = addOnQuantity(a);
      if (existing) {
        existing.quantity = Math.min(
          MAX_ADDON_QUANTITY,
          existing.quantity + quantity
        );
      } else {
        addOnByKey.set(hit.id, { name: hit.name, price: hit.price, quantity });
      }
    }
    const resolvedAddOns = [...addOnByKey.values()];

    // 5b. Server-authoritative pricing
    const pricing = await computeBookingPrice({
      serviceType: input.serviceType,
      bedCount: input.bedCount,
      bathCount: input.bathCount,
      halfBathCount: input.halfBathCount,
      squareFootage: input.squareFootage,
      pcHours: input.pcHours,
      pcCleaners: input.pcCleaners,
      addOns: resolvedAddOns,
      travelFee: areaCheck.travelFee ?? 0,
      discountAmount,
    });

    // 5b-bis. Re-resolve the promo code server-side. `applyPromoCode` runs as a
    // separate public action during checkout and its result comes back through
    // the browser, so the discount figure and the code itself are both
    // tamperable. We re-run the lookup against the SERVER-computed subtotal and
    // record only what the catalog actually authorises.
    let appliedPromoCode: string | null = null;
    let promoDiscountAmount: number | null = null;
    const submittedPromo = input.promoCode?.trim();
    if (submittedPromo) {
      // The promo is resolved against the GROSS pre-tax subtotal — base +
      // add-ons + travel, before the referral credit — which is exactly the
      // figure Step 5 quotes the code against. Using `pricing.subtotal`
      // (already net of the referral credit) would make a PERCENT code worth
      // less on the server than the amount the customer was shown.
      const promoBaseSubtotal =
        pricing.basePrice + pricing.addOnTotal + pricing.travelFee;
      const promo = await applyPromoCode(submittedPromo, promoBaseSubtotal);
      if (promo.valid && promo.discountAmount && promo.discountAmount > 0) {
        appliedPromoCode = submittedPromo.toUpperCase();
        promoDiscountAmount = promo.discountAmount;
      }
    }

    // 5b-ter. Fold the validated promo into the price the FIRST booking is
    // charged. Every charge path bills `Job.price - Job.discountAmount`
    // (`chargeJob`, `cardHoldActions`, invoicing, revenue metrics), so a promo
    // that is only recorded in `promoDiscountAmount` discounts nothing — the
    // customer sees a discounted quote and is billed in full. Recomputing here
    // puts it in `Job.price` the same way the referral credit already flows,
    // which keeps one source of truth instead of teaching five charge paths
    // about a second discount column.
    //
    // Deliberately NOT added to `Job.discountAmount`: that column is subtracted
    // AGAIN at charge time, so carrying the promo in both places would take it
    // off twice. It stays recorded in `promoDiscountAmount` for reporting.
    //
    // Pre-tax, like every other discount here, so GST/QST are charged on what
    // the customer actually pays.
    const primaryPricing = promoDiscountAmount
      ? await computeBookingPrice({
          serviceType: input.serviceType,
          bedCount: input.bedCount,
          bathCount: input.bathCount,
          halfBathCount: input.halfBathCount,
          squareFootage: input.squareFootage,
          pcHours: input.pcHours,
          pcCleaners: input.pcCleaners,
          addOns: resolvedAddOns,
          travelFee: areaCheck.travelFee ?? 0,
          discountAmount: discountAmount + promoDiscountAmount,
        })
      : pricing;

    // 5c. Idempotency guard — if the same client just created a job for the
    // same date + service within the last 60 seconds, treat this as a retry
    // and return that job instead of creating a duplicate.
    const startTime = parseStartTime(
      input.date,
      input.timeSlot,
      input.isFlexible
    );
    const sixtySecondsAgo = new Date(Date.now() - 60 * 1000);
    const recentDuplicate = await db.job.findFirst({
      where: {
        clientId: client.id,
        startTime,
        jobType: input.serviceType,
        createdAt: { gte: sixtySecondsAgo },
        parentJobId: null,
      },
      orderBy: { createdAt: "desc" },
    });
    if (recentDuplicate) {
      // No `deduplicated` flag in the response: this action is public, and the
      // flag told an unauthenticated caller whether a given email had just
      // booked a given service at a given time.
      return {
        success: true,
        jobId: recentDuplicate.id,
        childJobIds: [],
        total: recentDuplicate.price ?? primaryPricing.total,
        depositAmount: recentDuplicate.depositAmount ?? deposit.amountUsd,
        quotePending: isAwaitingQuote(recentDuplicate.quoteStatus),
      };
    }

    // 6. Create the primary Job

    // Property type (Stage 9 / PDF #11). Parsed ONCE, here, so the primary job
    // and every recurring child are written from the same value — and parsed
    // rather than passed through, because this action is public: anything that
    // isn't one of the two enum values (a hidden field, a stale client, a
    // crafted request) becomes null instead of reaching the column.
    const propertyType = parsePropertyType(input.propertyType);

    // The post-construction estimate the customer entered (Stage 11 / PDF #9).
    // Normalised through the SAME arithmetic `postConstructionBasePrice` used to
    // price it — round for hours, clamp crew to >= 1 — so the stored request and
    // the charged price can't describe two different jobs. Null on every other
    // service, which is what "this isn't a post-construction booking" means; a 0
    // would read as "zero cleaners were requested".
    const pcHours = isQuote
      ? Math.max(0, Math.round(Number(input.pcHours) || 0))
      : null;
    const pcCleaners = isQuote
      ? Math.max(1, Math.round(Number(input.pcCleaners) || 1))
      : null;

    // After-photo consent — saved to every job from this booking (incl. the
    // recurring children). Only stamp the timestamp/version when consent is
    // actually given so the absence of a timestamp reads as "no consent".
    const consentGiven = input.afterPhotoConsent === true;
    const afterPhotoConsentData = {
      afterPhotoConsent: consentGiven,
      afterPhotoConsentAt: consentGiven ? new Date() : null,
      afterPhotoConsentVersion: consentGiven ? AFTER_PHOTO_CONSENT_VERSION : null,
      // SMS consent defaults to true unless the customer explicitly unchecks it.
      smsConsent: input.smsConsent !== false,
    };

    let primaryJob;
    try {
      primaryJob = await db.job.create({
      data: {
        jobNumber: await allocateJobNumber(),
        clientName: client.name,
        client: { connect: { id: client.id } },
        location: bookingAddress,
        aptNumber: bookingApt,
        // Provenance to the saved address, so the cleaner page can read its
        // access notes and "apply to series" carries the choice (item 2).
        ...(clientAddressId ? { clientAddress: { connect: { id: clientAddressId } } } : {}),
        description: `${input.serviceType} cleaning`,
        jobType: input.serviceType,
        jobDate: startTime,
        startTime,
        // A quote request is never SCHEDULED, however specific the customer was
        // about the date (Stage 11). The date they picked is a PREFERENCE until
        // they approve the price, and stamping SCHEDULED would put unpriced work
        // on the calendar as though a crew were expected. `quoteStatus` below is
        // what hides it from cleaners; this is what keeps it off the schedule.
        status: isQuote || input.isFlexible ? "CREATED" : "SCHEDULED",
        // Round 4, fix 6 — both of the CREATED cases above are genuine holds,
        // and now each says which one it is. A quote is waiting on a price; a
        // flexible booking is waiting on a date. Before this they were the same
        // unlabelled grey block on the calendar as every admin-created job.
        // The quote reads first because a flexible post-construction booking is
        // blocked on the price before it is blocked on the date.
        holdReason: isQuote
          ? HOLD_REASON.QUOTE_PENDING
          : input.isFlexible
            ? HOLD_REASON.FLEXIBLE_DATE
            : null,
        bedCount: input.bedCount,
        bathCount: input.bathCount,
        halfBathCount: input.halfBathCount,
        squareFootage: input.squareFootage > 0 ? input.squareFootage : null,
        // PDF #11 - the customer's selection lands on the admin job with no
        // re-keying. Null when they skipped it or the admin hid the field.
        propertyType,
        isFlexible: input.isFlexible,
        // PDF #9 / Stage 11: was a hardcoded `1`, next to pricing that had just
        // multiplied by `pcCleaners`. So a customer who booked and paid for a
        // two-cleaner post-construction job reached the admin as a one-cleaner
        // job, and the crew size they were charged for existed nowhere. Clamped
        // to >= 1 through the same helpers the price used, so the number staffed
        // and the number billed are the same number.
        requiredCleaners: pcCleaners ?? 1,
        // The customer's own estimate, kept as the REQUEST it is. Null for every
        // non-post-construction booking, which is what those services mean.
        pcHours,
        pcCleaners,
        // Quote lifecycle. NULL for a normal booking — the column means "not a
        // quote" — and PENDING_REVIEW for post-construction, which is what makes
        // the admin queue, the cleaner-facing guards and the customer portal all
        // treat it as unpriced.
        quoteStatus: isQuote ? "PENDING_REVIEW" : null,
        // Net of BOTH the referral credit and the promo (see 5b-ter).
        price: primaryPricing.total,
        subtotalAmount: primaryPricing.subtotal,
        gstAmount: primaryPricing.gstAmount,
        qstAmount: primaryPricing.qstAmount,
        // THE amount this booking is worth, and what resolveAmountDue bills.
        // Web bookings never wrote this column, so every charge path fell
        // through to `price - discountAmount` — which subtracted the referral
        // credit a SECOND time, since `price` is already net of it. Writing it
        // here is what closes that: the credit now comes off exactly once.
        totalAmount: primaryPricing.total,
        // Referral credit / spent balance only — the promo is already inside
        // `price`. Kept for reporting and the discount column in exports; it is
        // no longer subtracted at charge time now that totalAmount is set.
        discountAmount: discountAmount > 0 ? discountAmount : null,
        appliedPromoCode,
        promoDiscountAmount,
        bookingSource: "web",
        // A web booking's stored subtotal is authoritative: it already contains
        // the add-ons AND is already net of the referral credit and the promo,
        // and it is the figure the customer's card was authorised against. So
        // the job is FINAL_PRICE (cleano_new_fixes.pdf fix 2) and its add-on
        // rows itemise that total rather than adding to it. Stamping it is what
        // makes an admin later editing this booking safe: the mode no longer
        // hangs on whether the price field still matches what we stored.
        pricingMode: "FINAL_PRICE",
        ...afterPhotoConsentData,
        notes: input.notes?.trim() || null,
        // Unconditional: a booking cannot reach this point without a verified
        // deposit. `depositPaymentIntentId` is also the refund target, so it
        // must only ever hold an intent we confirmed belongs to this booking.
        // It is UNIQUE — a concurrent replay of the same intent loses the race
        // with P2002 and is resolved to the winning job below.
        depositPaymentIntentId: deposit.paymentIntentId,
        depositPaid: true,
        depositPaidAt: new Date(),
        // WHAT WAS ACTUALLY CHARGED (Stage 11) — read off the verified
        // PaymentIntent's `amount_received`, never from the request body and never
        // re-derived from the setting. Every downstream credit, invoice line and
        // refund cap reads this column, so it must equal the money that moved.
        depositAmount: deposit.amountUsd,
        // Pin the card this booking was confirmed on, so a later card change
        // doesn't silently move the charge to a different card.
        stripePaymentMethodId: deposit.stripePaymentMethodId,
        addOns: {
          create: resolvedAddOns.map((a) => ({
            name: a.name,
            price: a.price,
            quantity: a.quantity,
          })),
        },
        // The customer's photos of the space (PDF #9). Written in the same
        // statement as the job so a quote request can never exist without the
        // photos it is supposed to be quoted from.
        //
        // `employeeId` is deliberately absent: this is what Stage 11's migration
        // made nullable. A guest booker has no `User` row and no crew is assigned
        // yet, so "nobody on staff took this" is the only honest value — and it is
        // what every reader uses to label the photo as the customer's.
        ...(photoUrls.length > 0
          ? {
              photos: {
                create: photoUrls.map((url) => ({
                  url,
                  caption: BOOKING_PHOTO_CAPTION,
                })),
              },
            }
          : {}),
      },
      });
    } catch (e) {
      // P2002 on depositPaymentIntentId: another request claimed this deposit
      // between our replay check and this insert. That request's booking is the
      // real one — return it instead of erroring or creating a second job on a
      // single payment.
      if (
        (e as { code?: string })?.code === "P2002" &&
        String((e as { meta?: { target?: unknown } })?.meta?.target ?? "").includes(
          "depositPaymentIntentId"
        )
      ) {
        const winner = await db.job.findFirst({
          where: { depositPaymentIntentId: deposit.paymentIntentId },
          select: {
            id: true,
            price: true,
            depositAmount: true,
            quoteStatus: true,
          },
        });
        if (winner) {
          return {
            success: true,
            jobId: winner.id,
            childJobIds: [],
            total: winner.price ?? primaryPricing.total,
            depositAmount: winner.depositAmount ?? deposit.amountUsd,
            quotePending: isAwaitingQuote(winner.quoteStatus),
          };
        }
      }
      throw e;
    }

    // Booking source, as a clear activity-log label. Jobs can originate three
    // ways — admin-created (saveJob / jobs/new), client-booked (here), or the
    // BookingKoala import — and the job log is where admin reads that from.
    await db.jobLog
      .create({
        data: {
          jobId: primaryJob.id,
          action: "CREATED",
          field: "bookingSource",
          newValue: "client-booked",
          description: `Job booked online by the client (${client.name})`,
        },
      })
      .catch((e) => console.error("submitBooking: source log", e));

    // PIC-004: record the after-photo consent decision in the job audit log
    // (admin-only — NOTE_ADDED is filtered out of the customer activity feed).
    await db.jobLog
      .create({
        data: {
          jobId: primaryJob.id,
          action: "NOTE_ADDED",
          field: "afterPhotoConsent",
          newValue: consentGiven ? "granted" : "declined",
          description: consentGiven
            ? `Customer granted after-photo consent at booking (${AFTER_PHOTO_CONSENT_VERSION}).`
            : "Customer declined after-photo consent at booking.",
        },
      })
      .catch((e) => console.error("after-photo consent log", e));

    // Payment audit trail: records the verified deposit and the card the
    // booking attached to the client, so a later dispute (or an attempt to
    // repoint a client's default card) is reconstructable from the admin log.
    await logActivity({
      category: "DEPOSIT",
      action: "booking.deposit_verified",
      actorLabel: "GUEST",
      targetType: "Client",
      targetId: client.id,
      // The amount that actually moved, not the constant — an audit trail that
      // reports every deposit as $20 is worse than no audit trail on the day a
      // $200 one is disputed.
      message: `Verified ${formatDeposit(deposit.amountUsd)} deposit for ${client.name} and created ${
        isQuote ? "post-construction quote request" : "booking"
      }.`,
      amount: deposit.amountUsd,
      providerId: deposit.paymentIntentId,
      metadata: {
        jobId: primaryJob.id,
        email,
        stripeCustomerId: deposit.stripeCustomerId,
        paymentMethodId: deposit.stripePaymentMethodId,
        isNewClient,
        quoteRequest: isQuote,
        photoCount: photoUrls.length,
      },
    });

    // Spend the credit on this client (deduct from balance)
    if (creditSpent > 0) {
      await db.client.update({
        where: { id: client.id },
        data: {
          referralCredit: { decrement: creditSpent },
        },
      });
    }

    // Credit the referrer for sending a new paying client our way
    if (referrerEligibleForCredit && referredByClientId) {
      const referrerCredit = await getSetting("customer.referrerCreditUsd");
      await db.client.update({
        where: { id: referredByClientId },
        data: {
          referralCredit: { increment: referrerCredit },
        },
      });
    }

    // 6b. Burn one use of the promo code — only for a code the server itself
    // validated above. Done as a single conditional UPDATE so the `maxUses` cap
    // is enforced atomically; a read-then-increment lets concurrent bookings
    // push a limited code past its cap.
    if (appliedPromoCode) {
      // Raw SQL bypasses the scoped client, so the organization is named here
      // explicitly. Without it, two companies running the same code -- WELCOME10
      // is not an imaginative choice -- would burn each other's uses. The
      // row-level policies would also catch this, but a filter that is only
      // correct because of a policy elsewhere is a filter waiting to be wrong.
      const promoOrgId = await requireOrgId();
      await db.$executeRaw`
        UPDATE "PromoCode"
           SET "usesCount" = "usesCount" + 1
         WHERE "code" = ${appliedPromoCode}
           AND "organizationId" = ${promoOrgId}
           AND "isActive" = true
           AND "deletedAt" IS NULL
           AND ("maxUses" IS NULL OR "usesCount" < "maxUses")
      `.catch(() => {});
    }

    // 6c. Win-back: if this client previously cancelled their recurring
    // service, mark that cancellation reactivated (and REDEEMED if they used
    // the save-offer code). Drives the retention KPI + offer funnel.
    const openCancellation = await db.recurringCancellation.findFirst({
      where: { clientId: client.id, reactivatedAt: null },
      orderBy: { cancelledAt: "desc" },
    });
    if (openCancellation) {
      // Compare against the SERVER-validated code, so the retention funnel
      // can't be marked "offer redeemed" by simply typing the code without it
      // actually being valid.
      const usedOffer =
        !!appliedPromoCode &&
        !!openCancellation.offerCode &&
        appliedPromoCode === openCancellation.offerCode.toUpperCase();
      await db.recurringCancellation
        .update({
          where: { id: openCancellation.id },
          data: {
            reactivatedAt: new Date(),
            ...(usedOffer ? { offerStatus: "REDEEMED" } : {}),
          },
        })
        .catch((e) => console.error("reactivation update", e));
      // §11: log win-back outcome on the CRM contact timeline.
      await logContactEvent(
        client.id,
        usedOffer ? "LIFECYCLE" : "BOOKING",
        usedOffer ? "Win-back offer redeemed" : "Reactivated after cancellation",
        usedOffer && openCancellation.offerCode
          ? `Booked again using win-back code ${openCancellation.offerCode}`
          : "Customer booked again after cancelling recurring service"
      );
    }

    // 7. Recurring jobs — copy the primary across future dates
    const weeklyHorizon = await getSetting("scheduling.recurringWeeklyHorizon");
    const recurrences = recurrenceCount(input.frequency, weeklyHorizon);
    const childJobIds: string[] = [];
    // `!isQuote` (Stage 11 / PDF #9): a quote-pending booking must not mint a
    // series. Its price is provisional and its scope is unreviewed, so generating
    // future visits would put N unpriced jobs on the books off ONE unreviewed
    // estimate — and every one of them would need re-pricing the moment the admin
    // set the real number. (In practice post-construction hides the frequency
    // control entirely, so `frequency` is already ONE_TIME; this is the guard for
    // a stale draft or a crafted request, which is exactly the case item 15's
    // coercion above exists for.)
    if (!isQuote && recurrences > 0 && input.frequency !== "ONE_TIME") {
      // Compute discounted price for 2nd+ cleanings (first cleaning is full price)
      const discountPct = await recurringDiscountPercent(
        input.frequency,
        input.serviceType
      );
      const recurringDiscount = discountPct > 0
        ? Math.round((pricing.basePrice * discountPct / 100) * 100) / 100
        : 0;
      // Child jobs (2nd+ visits) carry ONLY the recurring frequency discount.
      // The one-shot referral discount / spent credit (`discountAmount`) belongs
      // to the FIRST booking — the client's credit balance is decremented just
      // once (above), so re-applying it to every visit in the series would give
      // free money on jobs 2..N. Recompute whenever either discount is in play;
      // otherwise the child equals the (undiscounted) primary pricing.
      //
      // The promo code is a one-shot discount for the same reason: `usesCount`
      // is burned exactly once, so it applies to the first booking only. This
      // is why the child branches read `pricing` (referral-only) and never
      // `primaryPricing` — the latter has the promo folded in, and using it
      // here would repeat a single-use discount on every visit in the series.
      const childPricing =
        recurringDiscount > 0 || discountAmount > 0
          ? await computeBookingPrice({
              serviceType: input.serviceType,
              bedCount: input.bedCount,
              bathCount: input.bathCount,
              halfBathCount: input.halfBathCount ?? 0,
              squareFootage: input.squareFootage,
              pcHours: input.pcHours,
              pcCleaners: input.pcCleaners,
              addOns: resolvedAddOns,
              travelFee: pricing.travelFee,
              discountAmount: recurringDiscount,
            })
          : pricing;

      let cursor = startTime;
      for (let i = 0; i < recurrences; i++) {
        cursor = nextOccurrence(cursor, input.frequency);
        const child = await db.job.create({
          data: {
            jobNumber: await allocateJobNumber(),
            clientName: client.name,
            client: { connect: { id: client.id } },
            location: bookingAddress,
            aptNumber: bookingApt,
            // Every occurrence carries its own copy of the address, so the
            // provenance link has to be set per child too (item 2).
            ...(clientAddressId
              ? { clientAddress: { connect: { id: clientAddressId } } }
              : {}),
            description: `${input.serviceType} cleaning`,
            jobType: input.serviceType,
            jobDate: cursor,
            startTime: cursor,
            status: input.isFlexible ? "CREATED" : "SCHEDULED",
            // Same hold, same reason, per occurrence (round 4, fix 6). A quote
            // never reaches here — post-construction bookings are not recurring
            // — so the flexible case is the only one this loop can produce.
            holdReason: input.isFlexible ? HOLD_REASON.FLEXIBLE_DATE : null,
            bedCount: input.bedCount,
            bathCount: input.bathCount,
            halfBathCount: input.halfBathCount,
            squareFootage:
              input.squareFootage > 0 ? input.squareFootage : null,
            // Written explicitly, not spread: this is a literal payload, and a
            // series is one address, so every occurrence is at the same kind of
            // building (Stage 9 - it is in SERIES_PROPAGATED_FIELDS for the
            // same reason).
            propertyType,
            isFlexible: input.isFlexible,
            requiredCleaners: 1,
            price: childPricing.total,
            subtotalAmount: childPricing.subtotal,
            gstAmount: childPricing.gstAmount,
            qstAmount: childPricing.qstAmount,
            // As on the primary job. Without it every visit in the series had
            // its recurring frequency discount subtracted twice — and unlike
            // the one-shot referral credit, that repeated on EVERY visit.
            totalAmount: childPricing.total,
            discountAmount: childPricing.discountAmount > 0 ? childPricing.discountAmount : null,
            parentJob: { connect: { id: primaryJob.id } },
            bookingSource: "web",
            // As on the primary job — a series is one agreement, so every
            // occurrence is priced by the same rule (fix 2).
            pricingMode: "FINAL_PRICE",
            // Stage 8 deliberately adds NOTHING here. A web booking is quoted
            // as one agreed total by `computeBookingPrice` and stored as
            // FINAL_PRICE, so both the primary job and every child stay on
            // `billingType = FLAT` (the column default) and price exactly as
            // they did before that column existed. Post-construction is the one
            // hourly service the public flow offers, and its hours are already
            // folded into the quoted total by `postConstructionBasePrice`.
            // ⚠️ Stage 11 DOES give a post-construction job real hourly billing
            // columns — but never here, and that is the point. They are written by
            // `sendJobQuote` when an admin prices the request, long after this
            // code has run, and a quote-pending booking generates no children at
            // all (see the `!isQuote` guard on the loop above). So the hazard this
            // note warned about — a FLAT child under an HOURLY parent silently
            // re-pricing the series — cannot arise: there is no series.
            //
            // If post-construction ever becomes recurring, that guard is what has
            // to be revisited, together with this literal.
            //
            // Stage 10 also adds nothing here, for a different reason: the
            // public booking flow has no checklist control, so both the primary
            // job and every child keep `checklistTemplateId = NULL` (the column
            // default) and resolve automatically. A customer-scoped template
            // still reaches the whole series for free — every occurrence
            // carries the same `client` connect above, and that is what the
            // resolver matches on.
            ...afterPhotoConsentData,
            addOns: {
              create: resolvedAddOns.map((a) => ({
                name: a.name,
                price: a.price,
                quantity: a.quantity,
              })),
            },
          },
        });
        childJobIds.push(child.id);
      }
    }

    // 8. Mark the lead as converted (if we tracked one)
    const lead = await db.lead.findFirst({
      where: { email },
      orderBy: { createdAt: "desc" },
    });
    if (lead) {
      await db.lead.update({
        where: { id: lead.id },
        data: {
          status: "CONVERTED",
          convertedJobId: primaryJob.id,
          convertedAt: new Date(),
        },
      });
    }

    // 9. Send booking confirmation email
    const emailLog = await db.emailLog.create({
      data: {
        kind: "BOOKING_CONFIRMATION",
        recipient: email,
        subject: `Booking confirmed — ${input.date}`,
        status: "PENDING",
        jobId: primaryJob.id,
      },
    });
    await sendBookingConfirmation({
      to: email,
      clientName: client.name,
      jobId: primaryJob.id,
      jobNumber: primaryJob.jobNumber,
      startTime: startTime.toISOString(),
      isFlexible: input.isFlexible,
      address: bookingAddressLine,
      serviceType: input.serviceType,
      subtotal: primaryPricing.subtotal,
      gst: primaryPricing.gstAmount,
      qst: primaryPricing.qstAmount,
      total: primaryPricing.total,
      // Always true now — a booking cannot be created without a verified deposit.
      depositPaid: true,
      // The amount that was really charged (Stage 11). Without it the email's
      // "Deposit paid today / Remaining balance" rows would print $20 and a
      // remaining balance $180 short of what the card will actually be charged —
      // the same class of lie the deposit row was added to fix.
      depositAmount: deposit.amountUsd,
      // A quote request gets quote wording instead of "booking confirmed": the
      // date isn't booked and the total isn't the price yet.
      quotePending: isQuote,
      logId: emailLog.id,
      // ONE_TIME → cust.booking.receipt_ot; anything else (weekly/monthly/etc.)
      // → cust.booking.receipt_rec
      recurring: input.frequency !== "ONE_TIME",
    });

    // §7: advance the CRM contact lifecycle on a new booking (→ BOOKED, or
    // → RETURNING for an existing customer). Best-effort, never blocks booking.
    await advanceContactLifecycleForBooking(client.id, "BOOKING_CREATED");

    // If a referral code was applied, fire the dedicated catalog row
    // `admin.booking.new_via_referral` in addition to the regular
    // `admin.booking.new`. The fire-and-forget notifier handles the gate.
    if (input.referralCode?.trim()) {
      sendAdminNewBookingNotification({
        jobId: primaryJob.id,
        jobNumber: primaryJob.jobNumber,
        clientName: client.name,
        clientEmail: email,
        clientPhone: input.phone ?? null,
        startTime: startTime.toISOString(),
        isFlexible: input.isFlexible,
        address: bookingAddressLine,
        serviceType: input.serviceType,
        price: primaryPricing.total,
        bookingSource: "web (referral)",
        viaReferral: true,
      }).catch((err) =>
        console.error("admin new-booking-via-referral notification failed", err)
      );
    }

    // Notify all admins of the new booking — gated by `admin.booking.new` EMAIL.
    sendAdminNewBookingNotification({
      jobId: primaryJob.id,
      jobNumber: primaryJob.jobNumber,
      clientName: client.name,
      clientEmail: email,
      clientPhone: input.phone ?? null,
      startTime: startTime.toISOString(),
      isFlexible: input.isFlexible,
      address: bookingAddressLine,
      serviceType: input.serviceType,
      price: primaryPricing.total,
      bookingSource: "web",
    }).catch((err) =>
      console.error("admin new-booking notification failed", err)
    );

    // Customer "Bookings pre-paid" email — gated by `cust.fee.bookings_prepaid`.
    // Unconditional now: every web booking carries a verified deposit.
    sendCustomerBookingsPrepaid({
      to: email,
      clientName: client.name,
      jobId: primaryJob.id,
      jobNumber: primaryJob.jobNumber,
      amount: deposit.amountUsd,
    }).catch((err) => console.error("customer prepaid email", err));

    // 10. Log the booking activity on the primary job
    await db.jobLog.create({
      data: {
        jobId: primaryJob.id,
        action: "CREATED",
        description: isQuote
          ? `Post-construction quote requested via web by ${client.name} — ${formatDeposit(
              deposit.amountUsd
            )} deposit paid, ${photoUrls.length} photo${
              photoUrls.length === 1 ? "" : "s"
            } attached, awaiting review`
          : `Booked via web by ${client.name}`,
      },
    });

    return {
      success: true,
      jobId: primaryJob.id,
      childJobIds,
      total: primaryPricing.total,
      // Both read by the confirmation screen, which must not promise a scheduled
      // cleaning on a job that is still a quote request.
      depositAmount: deposit.amountUsd,
      quotePending: isQuote,
    };
  } catch (error) {
    console.error("Error submitting booking:", error);
    return { success: false, error: "Failed to submit booking. Please try again." };
  }
}

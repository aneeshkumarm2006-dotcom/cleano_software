"use server";

import { db } from "@/db";
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
  NEW_CLIENT_DISCOUNT,
  REFERRER_CREDIT,
} from "@/lib/referral";
import {
  sendBookingConfirmation,
  sendAdminNewBookingNotification,
  sendCustomerBookingsPrepaid,
} from "@/lib/email";
import { isValidEmail, isValidPhone } from "@/lib/validation";
import { AFTER_PHOTO_CONSENT_VERSION } from "@/lib/policy";

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
  bedCount: number;
  bathCount: number;
  halfBathCount: number;
  squareFootage: number;
  serviceType: string;
  pcHours?: number; // post-construction hours (drives hourly/package pricing)
  frequency: Frequency;
  // Client sends id (preferred) and/or name; the price is resolved server-side
  // from the catalog and any client-supplied price is ignored.
  addOns: { id?: string; name: string; price?: number }[];
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
  promoCode?: string;
  promoDiscount?: number;
  // Optional
  leadId?: string;
  depositPaymentIntentId?: string;
  stripeCustomerId?: string;
  stripePaymentMethodId?: string;
}

function parseStartTime(date: string, timeSlot: string, isFlexible: boolean): Date {
  // Defaults to 9am for flexible bookings — admin sets the real time later.
  const slot = isFlexible || !timeSlot ? "09:00" : timeSlot;
  return new Date(`${date}T${slot}:00`);
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
            address: input.address.trim(),
            serviceFrequency: storeFrequency,
            ...(input.stripeCustomerId && { stripeCustomerId: input.stripeCustomerId }),
            ...(input.stripePaymentMethodId && { defaultPaymentMethodId: input.stripePaymentMethodId }),
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
            ...(input.stripeCustomerId && { stripeCustomerId: input.stripeCustomerId }),
            ...(input.stripePaymentMethodId && { defaultPaymentMethodId: input.stripePaymentMethodId }),
          },
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
      discountAmount = NEW_CLIENT_DISCOUNT;
    } else if (!isNewClient && client.referralCredit > 0) {
      // Spend up to 50% of subtotal in credit (sanity cap), to be tuned later.
      creditSpent = Math.min(client.referralCredit, 50);
      discountAmount = creditSpent;
    }

    // 5a-bis. Resolve add-on prices server-side from the configured catalog.
    // Never trust prices from the client — they're tamperable (a negative price
    // could drag the whole booking to $0). Add-ons not in the catalog are dropped.
    const { addOns: addOnCatalog } = await getBookingConfig();
    const addOnById = new Map(addOnCatalog.map((a) => [a.id, a]));
    const addOnByName = new Map(
      addOnCatalog.map((a) => [a.name.trim().toLowerCase(), a])
    );
    const resolvedAddOns = (input.addOns ?? [])
      .map((a) => {
        const hit =
          (a.id && addOnById.get(a.id)) ||
          addOnByName.get((a.name ?? "").trim().toLowerCase());
        return hit ? { name: hit.name, price: hit.price } : null;
      })
      .filter((a): a is { name: string; price: number } => a !== null);

    // 5b. Server-authoritative pricing
    const pricing = await computeBookingPrice({
      serviceType: input.serviceType,
      bedCount: input.bedCount,
      bathCount: input.bathCount,
      halfBathCount: input.halfBathCount,
      squareFootage: input.squareFootage,
      pcHours: input.pcHours,
      addOns: resolvedAddOns,
      travelFee: areaCheck.travelFee ?? 0,
      discountAmount,
    });

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
      return {
        success: true,
        jobId: recentDuplicate.id,
        childJobIds: [],
        total: recentDuplicate.price ?? pricing.total,
        deduplicated: true as const,
      };
    }

    // 6. Create the primary Job

    // After-photo consent — saved to every job from this booking (incl. the
    // recurring children). Only stamp the timestamp/version when consent is
    // actually given so the absence of a timestamp reads as "no consent".
    const consentGiven = input.afterPhotoConsent === true;
    const afterPhotoConsentData = {
      afterPhotoConsent: consentGiven,
      afterPhotoConsentAt: consentGiven ? new Date() : null,
      afterPhotoConsentVersion: consentGiven ? AFTER_PHOTO_CONSENT_VERSION : null,
    };

    const primaryJob = await db.job.create({
      data: {
        clientName: client.name,
        client: { connect: { id: client.id } },
        location: input.address.trim(),
        description: `${input.serviceType} cleaning`,
        jobType: input.serviceType,
        jobDate: startTime,
        startTime,
        status: input.isFlexible ? "CREATED" : "SCHEDULED",
        bedCount: input.bedCount,
        bathCount: input.bathCount,
        halfBathCount: input.halfBathCount,
        squareFootage: input.squareFootage > 0 ? input.squareFootage : null,
        isFlexible: input.isFlexible,
        requiredCleaners: 1,
        price: pricing.total,
        subtotalAmount: pricing.subtotal,
        gstAmount: pricing.gstAmount,
        qstAmount: pricing.qstAmount,
        discountAmount: discountAmount > 0 ? discountAmount : null,
        appliedPromoCode: input.promoCode?.trim() || null,
        promoDiscountAmount: input.promoDiscount && input.promoDiscount > 0 ? input.promoDiscount : null,
        bookingSource: "web",
        ...afterPhotoConsentData,
        notes: input.notes?.trim() || null,
        ...(input.depositPaymentIntentId && {
          depositPaymentIntentId: input.depositPaymentIntentId,
          depositPaid: true,
          depositPaidAt: new Date(),
        }),
        addOns: {
          create: resolvedAddOns.map((a) => ({
            name: a.name,
            price: a.price,
          })),
        },
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
      await db.client.update({
        where: { id: referredByClientId },
        data: {
          referralCredit: { increment: REFERRER_CREDIT },
        },
      });
    }

    // 6b. Increment promo code usage if applied
    if (input.promoCode?.trim() && input.promoDiscount && input.promoDiscount > 0) {
      await db.promoCode.updateMany({
        where: { code: input.promoCode.trim().toUpperCase(), isActive: true },
        data: { usesCount: { increment: 1 } },
      }).catch(() => {});
    }

    // 6c. Win-back: if this client previously cancelled their recurring
    // service, mark that cancellation reactivated (and REDEEMED if they used
    // the save-offer code). Drives the retention KPI + offer funnel.
    const openCancellation = await db.recurringCancellation.findFirst({
      where: { clientId: client.id, reactivatedAt: null },
      orderBy: { cancelledAt: "desc" },
    });
    if (openCancellation) {
      const usedOffer =
        !!input.promoCode?.trim() &&
        !!openCancellation.offerCode &&
        input.promoCode.trim().toUpperCase() ===
          openCancellation.offerCode.toUpperCase();
      await db.recurringCancellation
        .update({
          where: { id: openCancellation.id },
          data: {
            reactivatedAt: new Date(),
            ...(usedOffer ? { offerStatus: "REDEEMED" } : {}),
          },
        })
        .catch((e) => console.error("reactivation update", e));
    }

    // 7. Recurring jobs — copy the primary across future dates
    const recurrences = recurrenceCount(input.frequency);
    const childJobIds: string[] = [];
    if (recurrences > 0 && input.frequency !== "ONE_TIME") {
      // Compute discounted price for 2nd+ cleanings (first cleaning is full price)
      const discountPct = recurringDiscountPercent(input.frequency);
      const recurringDiscount = discountPct > 0
        ? Math.round((pricing.basePrice * discountPct / 100) * 100) / 100
        : 0;
      const childPricing = recurringDiscount > 0
        ? await computeBookingPrice({
            serviceType: input.serviceType,
            bedCount: input.bedCount,
            bathCount: input.bathCount,
            halfBathCount: input.halfBathCount ?? 0,
            squareFootage: input.squareFootage,
            pcHours: input.pcHours,
            addOns: resolvedAddOns,
            travelFee: pricing.travelFee,
            discountAmount: discountAmount + recurringDiscount,
          })
        : pricing;

      let cursor = startTime;
      for (let i = 0; i < recurrences; i++) {
        cursor = nextOccurrence(cursor, input.frequency);
        const child = await db.job.create({
          data: {
            clientName: client.name,
            client: { connect: { id: client.id } },
            location: input.address.trim(),
            description: `${input.serviceType} cleaning`,
            jobType: input.serviceType,
            jobDate: cursor,
            startTime: cursor,
            status: input.isFlexible ? "CREATED" : "SCHEDULED",
            bedCount: input.bedCount,
            bathCount: input.bathCount,
            halfBathCount: input.halfBathCount,
            squareFootage:
              input.squareFootage > 0 ? input.squareFootage : null,
            isFlexible: input.isFlexible,
            requiredCleaners: 1,
            price: childPricing.total,
            subtotalAmount: childPricing.subtotal,
            gstAmount: childPricing.gstAmount,
            qstAmount: childPricing.qstAmount,
            discountAmount: childPricing.discountAmount > 0 ? childPricing.discountAmount : null,
            parentJob: { connect: { id: primaryJob.id } },
            bookingSource: "web",
            ...afterPhotoConsentData,
            addOns: {
              create: resolvedAddOns.map((a) => ({
                name: a.name,
                price: a.price,
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
      address: input.address.trim(),
      serviceType: input.serviceType,
      subtotal: pricing.subtotal,
      gst: pricing.gstAmount,
      qst: pricing.qstAmount,
      total: pricing.total,
      depositPaid: !!input.depositPaymentIntentId,
      logId: emailLog.id,
      // ONE_TIME → cust.booking.receipt_ot; anything else (weekly/monthly/etc.)
      // → cust.booking.receipt_rec
      recurring: input.frequency !== "ONE_TIME",
    });

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
        address: input.address.trim(),
        serviceType: input.serviceType,
        price: pricing.total,
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
      address: input.address.trim(),
      serviceType: input.serviceType,
      price: pricing.total,
      bookingSource: "web",
    }).catch((err) =>
      console.error("admin new-booking notification failed", err)
    );

    // Customer "Bookings pre-paid" email when a deposit was collected at
    // booking time — gated by `cust.fee.bookings_prepaid`.
    if (input.depositPaymentIntentId) {
      sendCustomerBookingsPrepaid({
        to: email,
        clientName: client.name,
        jobId: primaryJob.id,
        jobNumber: primaryJob.jobNumber,
        amount: 20, // $20 deposit per the existing booking flow
      }).catch((err) => console.error("customer prepaid email", err));
    }

    // 10. Log the booking activity on the primary job
    await db.jobLog.create({
      data: {
        jobId: primaryJob.id,
        action: "CREATED",
        description: `Booked via web by ${client.name}`,
      },
    });

    return {
      success: true,
      jobId: primaryJob.id,
      childJobIds,
      total: pricing.total,
    };
  } catch (error) {
    console.error("Error submitting booking:", error);
    return { success: false, error: "Failed to submit booking. Please try again." };
  }
}

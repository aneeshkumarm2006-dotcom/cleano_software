"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getTaxRates } from "@/lib/tax.server";
import { computeJobTaxes, isJobTaxExempt } from "@/lib/tax";
import { sendCustomerFinalQuote } from "@/lib/email";
import { logActivity } from "@/lib/activity-log";
import { resolveDepositCredit } from "@/lib/booking-deposit";
import { hourlyLineLabel, roundBilledHours, MAX_BILLED_HOURS } from "@/lib/hourly-billing";
import { formatAddressLine } from "@/lib/client-address";

/**
 * Send the FINAL QUOTE for a post-construction booking (PDF #9, Stage 11, step
 * 11.4): *"admin can review photos, adjust the quote, and send the final price to
 * the client"*.
 *
 * ## What this writes, and why it writes it that way
 *
 * The quoted figure is the job's real price from this moment on, so it goes into
 * the same columns every other price goes into — `price`, `subtotalAmount`,
 * `gstAmount`, `qstAmount`, `totalAmount` — and it is stamped
 * `pricingMode = FINAL_PRICE`, which is what a quoted total IS: one agreed number
 * the admin set, not an itemisation that add-ons can move. `resolveAmountDue`
 * then bills `totalAmount` minus the deposit with no further arithmetic, so what
 * the customer was emailed and what their card is charged are the same number.
 *
 * A quote can be sent HOURLY (rate × hours, PDF #9's natural shape for this
 * service) or FLAT. On the hourly path the derived amount is ALSO mirrored into
 * `price`, exactly as both save paths do — see the `hourlyBase` note in
 * saveJob.ts. Never invert that: `computeJobMoney` is the live authority and the
 * column is the mirror.
 *
 * ## What it does NOT do
 *
 * It does not schedule the job and it does not flip `quoteStatus` to ACCEPTED.
 * Sending a price is not the customer agreeing to it. Acceptance is decision D10,
 * shipped as the recommended default — an admin flips it in `resolveJobQuote`
 * once the customer confirms — so this action stops at QUOTED.
 */

interface SendJobQuoteInput {
  jobId: string;
  /** FLAT: the agreed total, pre-tax. HOURLY: ignored, derived from rate × hours. */
  billingType: "FLAT" | "HOURLY";
  /** Pre-tax service price. Required on the FLAT path. */
  price?: number;
  /** Customer-facing $/hr. Required on the HOURLY path. */
  billedHourlyRate?: number;
  /** Quoted hours. Required on the HOURLY path. */
  billedEstimatedHours?: number;
  /** Optional note included in the email — scope, assumptions, exclusions. */
  message?: string;
}

export async function sendJobQuote(input: SendJobQuoteInput) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    // OWNER/ADMIN only. Deliberately NOT the wider `isAdminRole`: this sets a
    // customer's price and sends it to them, which is exactly the class of thing
    // an OPS_MANAGER or FIELD_LEAD must not be able to do (see the role note in
    // §4 of the TODO — "the page is under /admin/" is not a money guard).
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }
    if (!input.jobId) return { success: false, error: "Missing jobId" };

    const job = await db.job.findUnique({
      where: { id: input.jobId },
      select: {
        id: true,
        jobNumber: true,
        quoteStatus: true,
        startTime: true,
        location: true,
        aptNumber: true,
        discountAmount: true,
        isCashJob: true,
        taxExempt: true,
        depositPaid: true,
        depositAmount: true,
        notifyClient: true,
        client: { select: { email: true, name: true } },
        clientName: true,
      },
    });
    if (!job) return { success: false, error: "Job not found" };

    // Only a live quote can be quoted. An ACCEPTED job is a normal job — repricing
    // it belongs on the job form, where the edit is logged as a price change
    // rather than as a quote — and a job with no `quoteStatus` was never a quote
    // at all, so this action must not invent one for it.
    if (job.quoteStatus !== "PENDING_REVIEW" && job.quoteStatus !== "QUOTED") {
      return {
        success: false,
        error: job.quoteStatus
          ? `This quote is already ${job.quoteStatus.toLowerCase().replace("_", " ")}. Edit the price on the job form instead.`
          : "This job isn't a quote request.",
      };
    }

    // ── Resolve the quoted service amount ────────────────────────────────────
    let servicePrice: number;
    let billedHourlyRate: number | null = null;
    let billedEstimatedHours: number | null = null;

    if (input.billingType === "HOURLY") {
      const rate = Number(input.billedHourlyRate);
      // Rounded with the SAME helper the clock-out snapshot uses (decision D7), so
      // a quote typed as 6.6h and a job measured at 6.6h bill identically.
      const hours = roundBilledHours(Number(input.billedEstimatedHours));
      if (!Number.isFinite(rate) || rate <= 0) {
        return { success: false, error: "Enter an hourly rate above $0." };
      }
      if (hours <= 0 || hours > MAX_BILLED_HOURS) {
        return { success: false, error: "Enter the number of hours you're quoting." };
      }
      billedHourlyRate = Math.round(rate * 100) / 100;
      billedEstimatedHours = hours;
      servicePrice = Math.round(billedHourlyRate * hours * 100) / 100;
    } else {
      const price = Number(input.price);
      if (!Number.isFinite(price) || price <= 0) {
        return { success: false, error: "Enter a quoted price above $0." };
      }
      servicePrice = Math.round(price * 100) / 100;
    }

    // Taxes recomputed from the quoted figure with the live rates, the same way
    // saveJob does it. The existing `discountAmount` is honoured — a referral
    // credit or promo the customer earned at booking does not evaporate because
    // the job got repriced.
    const rates = await getTaxRates();
    const exempt = isJobTaxExempt(job);
    const discount = Math.max(0, Number(job.discountAmount) || 0);
    const taxes = computeJobTaxes(
      Math.max(0, servicePrice - discount),
      rates,
      exempt
    );

    const deposit = resolveDepositCredit(job);
    const quotedAt = new Date();

    await db.$transaction([
      db.job.update({
        where: { id: job.id },
        data: {
          quoteStatus: "QUOTED",
          quotedAt,
          billingType: input.billingType,
          billedHourlyRate,
          billedEstimatedHours,
          // On the hourly path this MIRRORS rate × hours; on the flat path it IS
          // the quoted service price. Either way it matches what
          // `computeJobMoney` derives, which is what keeps the ~15 reporting
          // queries that still read `price` in agreement with the invoice.
          price: servicePrice,
          subtotalAmount: taxes.subtotalAmount,
          gstAmount: taxes.gstAmount,
          qstAmount: taxes.qstAmount,
          // THE billed figure. `resolveAmountDue` prefers this and then takes the
          // deposit off it, so the emailed balance is the charge.
          totalAmount: taxes.totalAmount,
          // A quote is one agreed total, not a sum of parts — see the enum note in
          // schema.prisma. Add-on rows stay as scope, and stop moving the money.
          pricingMode: "FINAL_PRICE",
        },
      }),
      db.jobLog.create({
        data: {
          jobId: job.id,
          userId: session.user.id,
          action: "UPDATED",
          field: "quoteStatus",
          oldValue: job.quoteStatus,
          newValue: "QUOTED",
          description:
            `Final quote sent: ${
              input.billingType === "HOURLY"
                ? `${billedEstimatedHours}h × $${billedHourlyRate!.toFixed(2)}/hr = `
                : ""
            }$${servicePrice.toFixed(2)} + tax = $${taxes.totalAmount.toFixed(2)}` +
            (deposit > 0
              ? ` (less $${deposit.toFixed(2)} deposit = $${Math.max(
                  0,
                  taxes.totalAmount - deposit
                ).toFixed(2)} due)`
              : "") +
            (input.message?.trim() ? ` — "${input.message.trim()}"` : ""),
        },
      }),
    ]);

    // ── Email the customer ───────────────────────────────────────────────────
    // Best-effort AFTER the write, and never inside the transaction: a send that
    // fails must not roll back the price the admin just set. The result is
    // reported back so the panel can say "priced, but the email didn't go out"
    // instead of claiming success — an admin who thinks a quote was sent will
    // wait for a reply that never comes.
    let emailed = false;
    let emailError: string | null = null;

    if (!job.client?.email) {
      emailError = "This customer has no email address on file.";
    } else if (!job.notifyClient) {
      // The per-booking mute. Honoured rather than bypassed — an admin turned it
      // off for this job on purpose — but reported, for the same reason.
      emailError =
        "Customer notifications are muted for this booking, so no email was sent.";
    } else {
      const emailLog = await db.emailLog.create({
        data: {
          // `OTHER` rather than a new EmailKind value: the enum drives filters and
          // retry behaviour across the app, and the subject line already names
          // this message. Adding a value would be a second migration for a label.
          kind: "OTHER",
          recipient: job.client.email,
          subject: `Your Cleano quote — $${taxes.totalAmount.toFixed(2)}`,
          status: "PENDING",
          jobId: job.id,
        },
      });
      const res = await sendCustomerFinalQuote({
        to: job.client.email,
        clientName: job.client.name ?? job.clientName,
        jobId: job.id,
        jobNumber: job.jobNumber,
        startTime: job.startTime.toISOString(),
        address:
          formatAddressLine({ address: job.location, aptNumber: job.aptNumber }) ||
          "—",
        total: taxes.totalAmount,
        subtotal: taxes.subtotalAmount,
        gst: taxes.gstAmount,
        qst: taxes.qstAmount,
        depositAmount: deposit,
        message: input.message ?? null,
        hourlyLine: hourlyLineLabel({
          billingType: input.billingType,
          billedHourlyRate,
          billedEstimatedHours,
        }),
        logId: emailLog.id,
      }).catch((e) => {
        console.error("sendJobQuote: email failed", e);
        return { ok: false as const };
      });
      emailed = res.ok === true;
      if (!emailed) {
        // Points at "Send again", not at the Emails log: `retryEmail` only knows
        // how to rebuild a BOOKING_CONFIRMATION, so telling an admin to retry it
        // there would send them to a button that reports "retry isn't supported".
        // Re-sending from the panel works — the price is already saved, and this
        // action accepts a job that is already QUOTED.
        emailError =
          "The quote was saved, but the email didn't send. Press “Re-send updated quote” to try again.";
      }
    }

    await logActivity({
      category: "BOOKING",
      action: "job.quote_sent",
      status: emailed ? "SUCCESS" : "FAILED",
      actorId: session.user.id,
      targetType: "job",
      targetId: job.id,
      amount: taxes.totalAmount,
      error: emailError,
      message: `Quoted $${taxes.totalAmount.toFixed(2)} on job #${job.jobNumber}${
        emailed ? " and emailed the customer" : ""
      }.`,
      metadata: {
        billingType: input.billingType,
        servicePrice,
        depositCredited: deposit,
        balanceDue: Math.max(0, taxes.totalAmount - deposit),
      },
    });

    revalidatePath(`/admin/jobs/${job.id}`);
    revalidatePath("/admin/jobs");
    revalidatePath("/admin/web-bookings");

    return {
      success: true,
      emailed,
      warning: emailError,
      total: taxes.totalAmount,
      balanceDue: Math.max(0, taxes.totalAmount - deposit),
    };
  } catch (error) {
    console.error("sendJobQuote error:", error);
    return { success: false, error: "Failed to send the quote" };
  }
}

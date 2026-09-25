import "server-only";

import { db } from "@/lib/org-db";
import { sendProviderNewJobPosted } from "@/lib/email";
import { isCategoryAllowed } from "@/lib/service-permissions";
import { serviceLabelMap } from "@/lib/service-catalog";
import { getServiceCatalog } from "@/lib/service-catalog.server";
import { computeJobPayout } from "@/lib/pay-tiers";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";

/**
 * Tell the cleaners who could claim it that a job is on the board.
 *
 * The board is pull-only: it shows what is open at the moment somebody opens
 * it. Work posted in the evening therefore sat unclaimed overnight while every
 * cleaner who could have taken it had no idea it existed (Aug 31 list, item 12).
 *
 * WHO GETS IT is the same test the board itself applies, not a broadcast:
 * active cleaners, not already on the job, and permitted to work this service
 * category. Sending to everyone would train people to ignore it, and would
 * offer work to cleaners who are barred from the category and cannot claim it.
 *
 * NEVER THROWS, and never blocks the caller. A job that saves but does not
 * email is a nuisance; an email failure that rolls back a booking is a fault.
 * Every send is fire-and-forget with its own catch, and each is recorded in
 * EmailLog first — which also dedupes, so a job saved four times in a row does
 * not email the crew four times.
 */

/** Roles that can actually pick work off the board. */
const CLAIMER_ROLES = ["EMPLOYEE", "FIELD_LEAD"] as const;

/**
 * The coarse area a cleaner may see BEFORE claiming — second address line with
 * any postal code stripped. Same rule the board prints, deliberately: this
 * email must not be able to disclose more than the page it links to.
 */
function deriveArea(location: string | null): string | null {
  if (!location) return null;
  const parts = location.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const area = parts[1].replace(/\s+[A-Z]\d[A-Z]\s*\d[A-Z]\d$/i, "").trim();
  return area || null;
}

export async function notifyNewJobPosted(jobId: string): Promise<void> {
  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        startTime: true,
        isFlexible: true,
        location: true,
        status: true,
        deletedAt: true,
        price: true,
        payType: true,
        employeeId: true,
        cleaners: { select: { id: true } },
      },
    });

    // Only genuinely open, future work is "posted". A job that already has a
    // crew, or has been cancelled, or is in the past, is not on the board — and
    // announcing it would send people to a listing they cannot see.
    if (!job || job.deletedAt) return;
    if (job.status === "CANCELLED" || job.status === "PAID") return;
    if (job.employeeId || job.cleaners.length > 0) return;
    if (job.startTime.getTime() <= Date.now()) return;

    const candidates = await db.user.findMany({
      where: {
        role: { in: [...CLAIMER_ROLES] },
        isActive: true,
        deletedAt: null,
        email: { not: "" },
      },
      select: {
        id: true,
        name: true,
        email: true,
        allowedServiceCategories: true,
      },
    });

    const eligible = candidates.filter((c) =>
      isCategoryAllowed(job.jobType, c.allowedServiceCategories)
    );
    if (eligible.length === 0) return;

    const labels = serviceLabelMap(await getServiceCatalog());
    const jobTypeLabel = job.jobType
      ? (labels[job.jobType] ?? job.jobType)
      : "Cleaning";
    const area = deriveArea(job.location);

    // Only PERCENTAGE work has an honest per-cleaner estimate before anyone is
    // assigned. FLAT is set by dispatch per assignment and HOURLY depends on
    // time nobody has worked yet, so those two say nothing rather than guess —
    // the same choice the board's cards make.
    const rates =
      job.payType === "PERCENTAGE" && job.price != null && job.price > 0
        ? await getCleanerRateInputs(eligible.map((c) => c.id)).catch(() => null)
        : null;

    for (const cleaner of eligible) {
      // Recorded before sending, and only once per cleaner per job: this is the
      // dedupe as well as the log, so re-saving a job cannot re-notify anyone.
      const already = await db.emailLog.findFirst({
        where: {
          notificationKey: "prov.unassigned.new",
          jobId: job.id,
          recipient: cleaner.email,
          status: { in: ["SENT", "PENDING", "FAILED"] },
        },
        select: { id: true },
      });
      if (already) continue;

      const log = await db.emailLog.create({
        data: {
          kind: "OTHER",
          notificationKey: "prov.unassigned.new",
          recipient: cleaner.email,
          subject: `New job available — ${jobTypeLabel}`,
          status: "PENDING",
          jobId: job.id,
        },
        select: { id: true },
      });

      let estPay: number | null = null;
      if (rates) {
        // `getCleanerRateInputs` returns a Map keyed by user id.
        const rate = rates.get(cleaner.id);
        if (rate) {
          estPay =
            computeJobPayout(job.price!, [rate]).shares.find(
              (sh) => sh.id === cleaner.id
            )?.amount ?? null;
        }
      }

      await sendProviderNewJobPosted({
        to: cleaner.email,
        providerName: cleaner.name,
        jobId: job.id,
        jobNumber: job.jobNumber,
        jobTypeLabel,
        startTime: job.startTime.toISOString(),
        isFlexible: job.isFlexible,
        area,
        estPay,
        logId: log.id,
      }).catch((e) => console.error("notifyNewJobPosted send", e));
    }
  } catch (e) {
    // Item 12: "If email fails, system should log the failure for admin." The
    // per-send failures land in EmailLog, which the admin can read; this catch
    // is for the lookup itself, which has no row to stamp.
    console.error("notifyNewJobPosted", e);
  }
}

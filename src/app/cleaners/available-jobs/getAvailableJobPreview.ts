"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { claimableJobsWhere } from "@/lib/cleaner-jobs";
import {
  isCategoryAllowed,
  CATEGORY_BLOCKED_MESSAGE,
} from "@/lib/service-permissions";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import { computeJobPayout, fallbackRateInput } from "@/lib/pay-tiers";
import { getServiceCatalogWithLabels } from "@/lib/service-catalog.server";
import { jobTypeLabel } from "@/lib/calendar-labels";
import { sanitizeCleanerNotes } from "@/lib/cleaner-notes";
import { formatAddressLine } from "@/lib/client-address";
import { addOnQuantity } from "@/lib/job-money";
import { templateMatchesJob } from "@/lib/checklist-triggers";
import type {
  AvailableJobPreview,
  AvailableJobPreviewResult,
} from "./getAvailableJobPreview.types";

/**
 * Everything a cleaner needs to decide whether to claim a job — WITHOUT
 * claiming it (awerfixes.pdf item 8).
 *
 * READ-ONLY. This action performs no writes of any kind: previewing does not
 * lock, hold, assign, or hide the job, and two cleaners can preview the same
 * job at the same moment and both still race for it normally. In particular it
 * matches checklist TEMPLATES to report what the job involves but never creates
 * a JobChecklist row. `scripts/verify-awer-fixes-3.ts` asserts the absence of
 * write calls in this file mechanically.
 *
 * Authorisation reuses `claimableJobsWhere` rather than restating the rule, so
 * a job a cleaner could not claim is a job they cannot preview, automatically
 * and forever. See ./getAvailableJobPreview.types.ts for what is withheld.
 */
export async function getAvailableJobPreview(
  jobId: string
): Promise<AvailableJobPreviewResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };

  const role = (session.user as { role?: string }).role;
  if (!role || role === "CLIENT") {
    return { success: false, error: "Not authorized" };
  }
  if (typeof jobId !== "string" || jobId.length === 0 || jobId.length > 64) {
    return { success: false, error: "Invalid request" };
  }

  const cleanerId = session.user.id;

  try {
    const job = await db.job.findFirst({
      // The claimable rule IS the visibility rule. Narrowing it by id keeps the
      // two in lockstep: soft-deleted, past, non-CREATED/SCHEDULED, and
      // already-mine jobs are all invisible here for free.
      where: { AND: [{ id: jobId }, claimableJobsWhere(cleanerId, new Date())] },
      select: {
        id: true,
        jobNumber: true,
        clientName: true,
        startTime: true,
        endTime: true,
        isFlexible: true,
        location: true,
        aptNumber: true,
        jobType: true,
        price: true,
        payType: true,
        hourlyRate: true,
        bedCount: true,
        bathCount: true,
        halfBathCount: true,
        squareFootage: true,
        requiredCleaners: true,
        notes: true,
        addOns: { select: { name: true, quantity: true } },
        cleaners: { select: { id: true } },
        // City / postal only — NOT accessNotes. See the types file.
        clientAddress: {
          select: { aptNumber: true, city: true, postalCode: true },
        },
      },
    });

    if (!job) {
      return { success: false, error: "This job is no longer available" };
    }
    // Capacity is a relation count, which the shared where-clause can't express
    // — the list page filters it in JS for the same reason.
    if (job.cleaners.length >= job.requiredCleaners) {
      return { success: false, error: "This job is already fully staffed" };
    }

    // Service category permission (awerfixes.pdf item 3), same JS-side reason:
    // jobType is free text, so the alias map decides. A job this cleaner may not
    // claim is a job they may not preview — the two stay in lockstep.
    const me = await db.user.findUnique({
      where: { id: cleanerId },
      select: { allowedServiceCategories: true },
    });
    if (!isCategoryAllowed(job.jobType, me?.allowedServiceCategories)) {
      return { success: false, error: CATEGORY_BLOCKED_MESSAGE };
    }

    const [{ labels: serviceLabels }, rateInputs, templates] = await Promise.all([
      getServiceCatalogWithLabels(),
      getCleanerRateInputs([cleanerId]),
      db.checklistTemplate.findMany({
        where: { isActive: true },
        select: {
          name: true,
          jobType: true,
          addOnName: true,
          items: { select: { isRequired: true } },
        },
      }),
    ]);

    // Same estimate the list card shows: this cleaner's own rate on the full
    // price, with the rating multiplier already inside the rate.
    let estPay: number | null = null;
    let estHourly: number | null = null;
    if (job.payType === "HOURLY") {
      estHourly = job.hourlyRate ?? null;
    } else if (job.payType === "PERCENTAGE" && job.price != null && job.price > 0) {
      const rate = rateInputs.get(cleanerId) ?? fallbackRateInput(cleanerId);
      const payout = computeJobPayout(job.price, [rate]);
      estPay = payout.shares.find((s) => s.id === cleanerId)?.amount ?? null;
    }
    // FLAT jobs are set per assignment by dispatch — no honest estimate exists.

    const addOnNames = job.addOns.map((a) => a.name);
    const checklistTemplates = templates
      .filter((t) =>
        templateMatchesJob(
          { jobType: t.jobType, addOnName: t.addOnName },
          { jobType: job.jobType, addOnNames }
        )
      )
      .map((t) => ({
        name: t.name,
        itemCount: t.items.length,
        requiredCount: t.items.filter((i) => i.isRequired).length,
      }));

    const preview: AvailableJobPreview = {
      id: job.id,
      jobNumber: job.jobNumber,
      clientName: job.clientName,
      startTime: job.startTime.toISOString(),
      isFlexible: job.isFlexible,
      serviceType: jobTypeLabel(job.jobType, serviceLabels) || null,
      address: job.location
        ? formatAddressLine({
            address: job.location,
            aptNumber: job.aptNumber ?? job.clientAddress?.aptNumber ?? null,
            city: job.clientAddress?.city ?? null,
            postalCode: job.clientAddress?.postalCode ?? null,
          })
        : null,
      bedCount: job.bedCount,
      bathCount: job.bathCount,
      halfBathCount: job.halfBathCount,
      squareFootage: job.squareFootage,
      addOns: job.addOns.map((a) => ({
        name: a.name,
        quantity: addOnQuantity(a),
      })),
      notes: sanitizeCleanerNotes(job.notes),
      durationMinutes:
        job.endTime && job.startTime
          ? Math.max(
              0,
              Math.round(
                (job.endTime.getTime() - job.startTime.getTime()) / 60_000
              )
            )
          : null,
      checklistTemplates,
      estPay,
      estHourly,
      payType: job.payType as string,
      requiredCleaners: job.requiredCleaners,
      claimedCount: job.cleaners.length,
    };

    return { success: true, preview };
  } catch (e) {
    console.error("getAvailableJobPreview", e);
    return { success: false, error: "Could not load this job" };
  }
}

"use server";

import { auth } from "@/lib/auth";
import { isStaffRole } from "@/lib/role-routing";
import { headers } from "next/headers";
import { CATEGORY_BLOCKED_MESSAGE } from "@bookmops/core/services";
import { formatAddressLine } from "@bookmops/core/property";
import { sanitizeCleanerNotes } from "@bookmops/core/jobs";
import { addOnQuantity } from "@/lib/job-money";

import { actorFromSession } from "@/server/actor";
import { loadAvailablePreview } from "@/server/available/board";
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
  // Client names, street addresses and prices: staff only. This used to
  // refuse only CLIENT, which let an APPLICANT read all of it.
  if (!isStaffRole(role)) {
    return { success: false, error: "Not authorized" };
  }
  if (typeof jobId !== "string" || jobId.length === 0 || jobId.length > 64) {
    return { success: false, error: "Invalid request" };
  }

  const actor = actorFromSession(
    session.user as { id: string; name?: string | null; email: string; role?: string | null },
  );

  try {
    // The claimable rule IS the visibility rule (claimableJobsWhere(cleanerId,
    // new Date()), then capacity, then the cleaner's categories), decided in
    // server/available/board.ts for the web board, this preview and the phone
    // alike. READ-ONLY: templates are matched, no JobChecklist is created.
    const r = await loadAvailablePreview(actor, jobId, new Date());
    if (!r.ok) {
      if (r.reason === "FULLY_STAFFED") {
        return { success: false, error: "This job is already fully staffed" };
      }
      if (r.reason === "CATEGORY_NOT_ALLOWED") {
        return { success: false, error: CATEGORY_BLOCKED_MESSAGE };
      }
      return { success: false, error: "This job is no longer available" };
    }
    const { job, serviceLabel, estPay, estHourly, checklists, durationMinutes } = r.preview;

    const preview: AvailableJobPreview = {
      id: job.id,
      jobNumber: job.jobNumber,
      clientName: job.clientName,
      startTime: job.startTime.toISOString(),
      isFlexible: job.isFlexible,
      serviceType: serviceLabel,
      address: job.location
        ? formatAddressLine({
            address: job.location,
            aptNumber: job.aptNumber ?? job.clientAddress?.aptNumber ?? null,
            city: job.clientAddress?.city ?? null,
            // Snapshot first, saved address second: a job with no address link
            // (an import, or a one-off address typed on the form) still shows a
            // postal code on the board instead of a bare street.
            postalCode: job.postalCode ?? job.clientAddress?.postalCode ?? null,
          })
        : null,
      propertyType: job.propertyType,
      bedCount: job.bedCount,
      bathCount: job.bathCount,
      halfBathCount: job.halfBathCount,
      squareFootage: job.squareFootage,
      addOns: job.addOns.map((a) => ({
        name: a.name,
        quantity: addOnQuantity(a),
      })),
      notes: sanitizeCleanerNotes(job.notes),
      durationMinutes,
      checklistTemplates: checklists,
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

"use server";

import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { requireOwnerAdmin } from "@/lib/action-guards";
import { resolveJobAddressId } from "@/lib/client-address-store";

/**
 * Attach an existing customer record to a job that has none (client feedback
 * item 4, Stage 4.7).
 *
 * A job with `clientId: null` is unreachable: every customer-facing email in
 * the admin is gated on `job.client?.email` and silently no-ops without it, and
 * the card can't be charged off-session. `scripts/auditOrphanJobs.ts` counts
 * them; this is the per-job repair.
 *
 * Deliberately NOT a client creator — the modal and the full-page form already
 * create profiles from typed contact details (src/lib/client-capture.ts). This
 * links to a record that exists, which is the case the forms can't cover: the
 * customer was booked twice under slightly different spellings, or their
 * profile was made later on the Clients page.
 *
 * The job's `clientName` / `location` snapshot is left ALONE. Those columns are
 * what the booking was actually taken as, and rewriting history to match a
 * record linked months later is how a completed job starts disagreeing with its
 * own invoice. Only the link is added — plus the address book entry, so the
 * next booking for this customer offers the door they were served at.
 */
export async function linkJobToClient(
  jobId: string,
  clientId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  if (typeof jobId !== "string" || !jobId.trim()) {
    return { success: false, error: "Job id is required" };
  }
  if (typeof clientId !== "string" || !clientId.trim()) {
    return { success: false, error: "Pick a customer to link" };
  }

  try {
    const [job, client] = await Promise.all([
      db.job.findUnique({
        where: { id: jobId },
        select: {
          id: true,
          clientId: true,
          jobNumber: true,
          location: true,
          aptNumber: true,
          postalCode: true,
          // Property size (item 3) — carried into the address book below, the
          // same way saving a job does it.
          propertyType: true,
          bedCount: true,
          bathCount: true,
          halfBathCount: true,
          squareFootage: true,
          deletedAt: true,
        },
      }),
      db.client.findFirst({
        where: { id: clientId, deletedAt: null },
        select: { id: true, name: true },
      }),
    ]);

    if (!job) return { success: false, error: "Job not found" };
    if (job.deletedAt) {
      return { success: false, error: "This booking is archived." };
    }
    if (!client) return { success: false, error: "Customer not found" };
    if (job.clientId) {
      return {
        success: false,
        error: "This job is already linked to a customer.",
      };
    }

    // Teach the customer's address book where this job was served, the same
    // way saving a job does. Enrich-only, so nothing already recorded is lost.
    const clientAddressId = job.location
      ? await resolveJobAddressId(client.id, {
          address: job.location,
          aptNumber: job.aptNumber,
          postalCode: job.postalCode,
          propertyType: job.propertyType,
          bedCount: job.bedCount,
          bathCount: job.bathCount,
          halfBathCount: job.halfBathCount,
          squareFootage: job.squareFootage,
        })
      : null;

    await db.job.update({
      where: { id: job.id },
      data: {
        clientId: client.id,
        ...(clientAddressId ? { clientAddressId } : {}),
      },
    });

    await db.jobLog
      .create({
        data: {
          jobId: job.id,
          userId: guard.userId,
          action: "UPDATED",
          description: `Linked to customer ${client.name}`,
        },
      })
      .catch(() => {});

    revalidatePath(`/admin/jobs/${job.id}`);
    revalidatePath("/admin/jobs");
    revalidatePath(`/admin/clients/${client.id}`);
    return { success: true };
  } catch (error) {
    console.error("linkJobToClient failed", error);
    return { success: false, error: "Could not link this job to a customer." };
  }
}

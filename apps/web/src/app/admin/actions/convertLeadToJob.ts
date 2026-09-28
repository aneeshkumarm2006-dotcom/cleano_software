"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { resolveJobClient } from "@/lib/client-capture";
import { allocateJobNumber } from "@/lib/job-number";

export async function convertLeadToJob(leadId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") return { error: "Not authorized" };

  const lead = await db.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: "Lead not found" };
  if (lead.convertedJobId) return { error: "Already converted" };

  // Stage 11.1. This path created the job with `clientId: null` — the same
  // orphan Stage 4 fixed on the two admin job forms, in the one place it
  // didn't reach. Every customer-facing email is gated on `job.client?.email`
  // and silently no-ops without it, so a converted lead could never be sent a
  // receipt, a cancellation or a rating request: a lead that converted and was
  // then lost anyway, which is the opposite of what item 19 asks for. The lead
  // always carries an email, so the dedupe-then-create helper always has
  // something safe to match on.
  const { clientId } = await resolveJobClient({
    clientName: lead.name || lead.email,
    clientEmail: lead.email,
    clientPhone: lead.phone,
    postalCode: lead.postalCode,
  });

  const job = await db.job.create({
    data: {
      jobNumber: await allocateJobNumber(),
      employeeId: session.user.id,
      clientId,
      clientName: lead.name || lead.email,
      description: lead.serviceType || null,
      jobDate: lead.preferredDate || null,
      startTime: lead.preferredDate || new Date(),
      bedCount: lead.bedCount,
      bathCount: lead.bathCount,
      location: lead.postalCode ? `Postal: ${lead.postalCode}` : null,
      postalCode: lead.postalCode,
    },
  });

  await db.lead.update({
    where: { id: leadId },
    data: {
      status: "CONVERTED",
      convertedJobId: job.id,
      convertedAt: new Date(),
      lastActivityAt: new Date(),
    },
  });

  revalidatePath("/admin/leads");
  revalidatePath("/admin/jobs");
  return { success: true, jobId: job.id };
}

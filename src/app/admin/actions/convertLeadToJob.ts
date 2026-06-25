"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

export async function convertLeadToJob(leadId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") return { error: "Not authorized" };

  const lead = await db.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: "Lead not found" };
  if (lead.convertedJobId) return { error: "Already converted" };

  const job = await db.job.create({
    data: {
      employeeId: session.user.id,
      clientName: lead.name || lead.email,
      description: lead.serviceType || null,
      jobDate: lead.preferredDate || null,
      startTime: lead.preferredDate || new Date(),
      bedCount: lead.bedCount,
      bathCount: lead.bathCount,
      location: lead.postalCode ? `Postal: ${lead.postalCode}` : null,
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

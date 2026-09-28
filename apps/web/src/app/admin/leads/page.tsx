import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/org-db";
import { findContactsForLeads } from "@/lib/lead-contacts";
import LeadsPageClient from "./LeadsPageClient";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") redirect("/admin/dashboard");

  const params = await searchParams;
  const archived = params.archived === "1";

  const leads = await db.lead.findMany({
    where: { deletedAt: archived ? { not: null } : null },
    orderBy: [{ lastActivityAt: "desc" }, { createdAt: "desc" }],
    include: {
      convertedJob: {
        select: { id: true, jobNumber: true, jobDate: true },
      },
    },
    take: 200,
  });

  // Which of these leads is already a CRM contact (item 19). Resolved live off
  // email/phone rather than stored on the lead: one person owns several Lead
  // rows and `Contact.leadId` can only point at one of them, and a stored flag
  // would keep claiming "exported" after the contact was archived by a merge.
  const contactByLead = await findContactsForLeads(leads);

  const serialized = leads.map((l) => ({
    id: l.id,
    email: l.email,
    name: l.name,
    phone: l.phone,
    postalCode: l.postalCode,
    dropOffStep: l.dropOffStep,
    serviceType: l.serviceType,
    bedCount: l.bedCount,
    bathCount: l.bathCount,
    preferredDate: l.preferredDate?.toISOString() ?? null,
    isFlexible: l.isFlexible,
    preferredSlot: l.preferredSlot,
    status: l.status,
    source: l.source,
    lastActivityAt: l.lastActivityAt.toISOString(),
    createdAt: l.createdAt.toISOString(),
    convertedJob: l.convertedJob
      ? {
          id: l.convertedJob.id,
          jobNumber: l.convertedJob.jobNumber,
          jobDate: l.convertedJob.jobDate?.toISOString() ?? null,
        }
      : null,
    contact: contactByLead.get(l.id) ?? null,
  }));

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <LeadsPageClient leads={serialized} archived={archived} />
    </div>
  );
}

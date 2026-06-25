import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import LeadsPageClient from "./LeadsPageClient";

export default async function LeadsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") redirect("/admin/dashboard");

  const leads = await db.lead.findMany({
    orderBy: [{ lastActivityAt: "desc" }, { createdAt: "desc" }],
    include: {
      convertedJob: {
        select: { id: true, jobNumber: true, jobDate: true },
      },
    },
    take: 200,
  });

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
  }));

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <LeadsPageClient leads={serialized} />
    </div>
  );
}

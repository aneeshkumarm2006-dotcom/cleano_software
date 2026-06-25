import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import WaitlistPageClient from "./WaitlistPageClient";

export default async function WaitlistPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") redirect("/admin/dashboard");

  const entries = await db.waitlist.findMany({
    orderBy: [{ preferredDate: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  const serialized = entries.map((w) => ({
    id: w.id,
    preferredDate: w.preferredDate.toISOString(),
    email: w.email,
    name: w.name,
    phone: w.phone,
    serviceType: w.serviceType,
    bedCount: w.bedCount,
    bathCount: w.bathCount,
    notes: w.notes,
    status: w.status,
    notifiedAt: w.notifiedAt?.toISOString() ?? null,
    createdAt: w.createdAt.toISOString(),
  }));

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <WaitlistPageClient entries={serialized} />
    </div>
  );
}

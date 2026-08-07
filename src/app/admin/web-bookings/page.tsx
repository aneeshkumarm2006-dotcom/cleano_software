import { requireAdmin } from "@/lib/page-guards";
import { db } from "@/db";
import WebBookingsPageClient from "./WebBookingsPageClient";

export default async function WebBookingsPage() {
  await requireAdmin();

  const jobs = await db.job.findMany({
    // Archived bookings only show in Jobs → Archived (new fix list item 1).
    where: { bookingSource: "web", deletedAt: null },
    orderBy: { startTime: "asc" },
    include: {
      client: { select: { id: true, name: true, email: true, phone: true } },
      cleaners: { select: { id: true, name: true } },
      addOns: { select: { name: true, price: true, quantity: true } },
    },
    take: 200,
  });

  const serialized = jobs.map((j) => ({
    id: j.id,
    jobNumber: j.jobNumber,
    status: j.status,
    isFlexible: j.isFlexible,
    startTime: j.startTime.toISOString(),
    location: j.location,
    jobType: j.jobType,
    price: j.price,
    requiredCleaners: j.requiredCleaners,
    parentJobId: j.parentJobId,
    cancellationRequestedAt: j.cancellationRequestedAt?.toISOString() ?? null,
    rescheduleRequestedAt: j.rescheduleRequestedAt?.toISOString() ?? null,
    client: j.client
      ? {
          id: j.client.id,
          name: j.client.name,
          email: j.client.email,
          phone: j.client.phone,
        }
      : null,
    cleaners: j.cleaners,
    addOns: j.addOns,
    createdAt: j.createdAt.toISOString(),
  }));

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <WebBookingsPageClient jobs={serialized} />
    </div>
  );
}

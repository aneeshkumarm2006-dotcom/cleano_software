import { requireOwnerAdmin } from "@/lib/page-guards";
import { db } from "@/lib/org-db";
import WebBookingsPageClient from "./WebBookingsPageClient";

export default async function WebBookingsPage() {
  // requireOwnerAdmin, NOT requireAdmin: `isAdminRole` admits OWNER, ADMIN,
  // OPS_MANAGER **and FIELD_LEAD** — it answers "may you reach /admin/*",
  // which is not the same question as "may you see money". This page prints
  // real balances/totals, and both of those roles are denied money everywhere
  // else (calendar price labels, dashboard revenue tiles, analytics). The page
  // was reachable by direct URL and its nav entry carried no `adminOnly`, so it
  // was not even hidden.
  await requireOwnerAdmin();

  const jobs = await db.job.findMany({
    // Archived bookings only show in Jobs → Archived (new fix list item 1).
    where: { bookingSource: "web", deletedAt: null },
    orderBy: { startTime: "asc" },
    include: {
      client: { select: { id: true, name: true, email: true, phone: true } },
      cleaners: { select: { id: true, name: true } },
      addOns: { select: { name: true, price: true, quantity: true } },
      // Stage 11 / PDF #9 — how many photos the customer attached, which is what
      // an admin is about to price the quote from. Counted rather than fetched:
      // this list renders up to 200 rows and needs the number, not the URLs.
      // `employeeId: null` is what identifies a CUSTOMER upload; a crew's
      // before/after shots on a worked job must not inflate it.
      _count: { select: { photos: { where: { employeeId: null } } } },
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
    quoteStatus: j.quoteStatus,
    bookingPhotoCount: j._count.photos,
  }));

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <WebBookingsPageClient jobs={serialized} />
    </div>
  );
}

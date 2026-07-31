import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { getTaxRates } from "@/lib/tax.server";
import { getSetting } from "@/lib/settings";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import { computeJobPayShares, type JobPayInput } from "@/lib/cleaner-earnings";
import JobDetailView from "./JobDetailView";

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const logsPage = Number(search.logsPage) || 1;
  const logsPerPage = 10;

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const job = await db.job.findUnique({
    where: { id },
    include: {
      employee: true,
      cleaners: true,
      client: true,
      addOns: true,
      productUsage: {
        include: {
          product: true,
        },
      },
      ratingTokens: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      // Per-cleaner live status rows (item 9).
      assignments: true,
      // Breaks taken on this job (item 26) — the time summary shows active
      // working time, which is elapsed minus these.
      breaks: true,
      // Manual/customer star ratings attached to this job (item 13).
      ratings: {
        include: { employee: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
      _count: {
        select: { logs: true },
      },
    },
  });

  if (!job) {
    redirect("/admin/jobs");
  }

  // Check if user has access to view this job
  if (
    job.employeeId !== session.user.id &&
    (session.user as any).role !== "OWNER" &&
    (session.user as any).role !== "ADMIN"
  ) {
    redirect("/admin/jobs");
  }

  // Fetch all users for the cleaner selector
  const users = await db.user.findMany({
    where: { role: { not: "CLIENT" } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
    },
  });

  const clients = await db.client.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      address: true,
      discountPercent: true,
      defaultPaymentMethodId: true,
    },
  });

  // Fetch paginated logs separately
  const totalLogs = job._count.logs;
  const logs = await db.jobLog.findMany({
    where: { jobId: id },
    include: {
      user: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    skip: (logsPage - 1) * logsPerPage,
    take: logsPerPage,
  });

  // Fetch all photos uploaded for this job
  const photos = await db.jobPhoto.findMany({
    where: { jobId: id },
    include: {
      employee: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Fetch client-submitted review photos (attached to poor ratings)
  const reviewPhotos = await db.reviewPhoto.findMany({
    where: { jobId: id },
    orderBy: { createdAt: "desc" },
  });

  // Calculate total cost of products used
  const totalProductCost = job.productUsage.reduce((sum, usage) => {
    return sum + usage.quantity * usage.product.costPerUnit;
  }, 0);

  // Check if user is admin
  const isAdmin =
    (session.user as any).role === "OWNER" ||
    (session.user as any).role === "ADMIN";

  // Current admin-configured GST/QST rates — used to label the tax rows and to
  // compute a display-only breakdown for older jobs saved without tax amounts.
  const taxRates = await getTaxRates();

  // Live GPS tracking toggle (#10) — gates the on-the-way map below.
  const gpsEnabled = await getSetting("tracking.gpsEnabled");

  // Per-cleaner pay — computed with the EXACT function payroll and My Pay use
  // (computeJobPayShares), so the Team card, the cleaner's app, and payday can
  // never disagree. It honours the pay type (PERCENTAGE tier split vs
  // FLAT/HOURLY team-total split) and any manual per-cleaner override.
  const participantIds = Array.from(
    new Set(
      [job.employeeId, ...job.cleaners.map((c) => c.id)].filter(
        (uid): uid is string => !!uid
      )
    )
  );
  const rateInputs = await getCleanerRateInputs(participantIds);
  const shares = computeJobPayShares(job as unknown as JobPayInput, rateInputs);
  const payShares: Record<string, number> = {};
  for (const [id, share] of shares) {
    payShares[id] = share.total;
  }
  // Current manual overrides, so the Team card can show which cleaners have one.
  const payOverrides: Record<string, number | null> = {};
  for (const a of job.assignments) {
    payOverrides[a.cleanerId] = a.payAmount ?? null;
  }

  // Server action to delete job
  async function deleteJob() {
    "use server";

    await db.job.delete({
      where: { id },
    });

    revalidatePath("/admin/jobs");
    redirect("/admin/jobs");
  }

  // Transform data for client component
  const jobData = {
    id: job.id,
    clientName: job.clientName,
    clientId: job.clientId,
    location: job.location,
    description: job.description,
    jobType: job.jobType,
    priorityLabel: job.priorityLabel,
    jobDate: job.jobDate?.toISOString() || null,
    startTime: job.startTime.toISOString(),
    endTime: job.endTime?.toISOString() || null,
    clockInTime: job.clockInTime?.toISOString() || null,
    clockOutTime: job.clockOutTime?.toISOString() || null,
    onMyWayAt: job.onMyWayAt?.toISOString() || null,
    onMyWayLat: job.onMyWayLat ?? null,
    onMyWayLng: job.onMyWayLng ?? null,
    onMyWayLocationAt: job.onMyWayLocationAt?.toISOString() || null,
    status: job.status,
    price: job.price,
    subtotalAmount: job.subtotalAmount,
    gstAmount: job.gstAmount,
    qstAmount: job.qstAmount,
    totalAmount: job.totalAmount,
    employeePay: job.employeePay,
    totalTip: job.totalTip,
    parking: job.parking,
    paymentReceived: job.paymentReceived,
    isCashJob: job.isCashJob,
    taxExempt: job.taxExempt,
    discountReason: job.discountReason,
    breaks: (job.breaks ?? []).map((b: { cleanerId: string; startedAt: Date; endedAt: Date | null }) => ({
      cleanerId: b.cleanerId,
      startedAt: b.startedAt.toISOString(),
      endedAt: b.endedAt ? b.endedAt.toISOString() : null,
    })),
    usesFixedPrice: job.usesFixedPrice,
    notifyClient: job.notifyClient,
    notifyProvider: job.notifyProvider,
    invoiceSent: job.invoiceSent,
    notes: job.notes,
    paymentType: job.paymentType,
    discountAmount: job.discountAmount,
    bedCount: job.bedCount,
    bathCount: job.bathCount,
    halfBathCount: job.halfBathCount,
    payRateMultiplier: job.payRateMultiplier,
    depositPaid: job.depositPaid,
    depositPaymentIntentId: job.depositPaymentIntentId,
    stripePaymentIntentId: job.stripePaymentIntentId,
    addOns: job.addOns.map((a) => ({
      id: a.id,
      name: a.name,
      price: a.price,
    })),
    employee: job.employee
      ? { id: job.employee.id, name: job.employee.name }
      : { id: "", name: "Unassigned" },
    cleaners: job.cleaners.map((c) => ({ id: c.id, name: c.name })),
    cancellationRequestedAt: job.cancellationRequestedAt?.toISOString() ?? null,
    rescheduleRequestedAt: job.rescheduleRequestedAt?.toISOString() ?? null,
    afterPhotoConsent: job.afterPhotoConsent,
    afterPhotoConsentAt: job.afterPhotoConsentAt?.toISOString() ?? null,
    afterPhotoConsentVersion: job.afterPhotoConsentVersion,
    afterPhotoOverrideAt: job.afterPhotoOverrideAt?.toISOString() ?? null,
    ratingTokens: job.ratingTokens.map((t) => ({
      id: t.id,
      usedAt: t.usedAt?.toISOString() ?? null,
      ratingStars: t.ratingStars,
      ratherNotAnswer: t.ratherNotAnswer,
      emailSentAt: t.emailSentAt?.toISOString() ?? null,
    })),
  };

  const productUsageData = job.productUsage.map((usage) => ({
    id: usage.id,
    quantity: usage.quantity,
    notes: usage.notes,
    product: {
      id: usage.product.id,
      name: usage.product.name,
      unit: usage.product.unit,
      costPerUnit: usage.product.costPerUnit,
    },
  }));

  const logsData = logs.map((log) => ({
    id: log.id,
    action: log.action,
    field: log.field,
    oldValue: log.oldValue,
    newValue: log.newValue,
    description: log.description,
    createdAt: log.createdAt.toISOString(),
    user: log.user ? { id: log.user.id, name: log.user.name } : null,
  }));

  const photosData = photos.map((photo) => ({
    id: photo.id,
    url: photo.url,
    caption: photo.caption,
    createdAt: photo.createdAt.toISOString(),
    employee: { id: photo.employee.id, name: photo.employee.name },
  }));

  const reviewPhotosData = reviewPhotos.map((photo) => ({
    id: photo.id,
    url: photo.url,
    rating: photo.rating,
    createdAt: photo.createdAt.toISOString(),
  }));

  // Per-cleaner assignment status rows. Jobs created before this feature have
  // none — the view derives a fallback from job-level clock fields.
  const assignmentsData = job.assignments.map((a) => ({
    cleanerId: a.cleanerId,
    status: a.status as string,
    onMyWayAt: a.onMyWayAt?.toISOString() ?? null,
    clockInTime: a.clockInTime?.toISOString() ?? null,
    clockOutTime: a.clockOutTime?.toISOString() ?? null,
  }));

  // Star ratings on this job. `ratedBy` holding a staff user id means the
  // rating was set manually by an admin (customer ratings come through the
  // review-token flow without a staff rater).
  const staffById = new Map(users.map((u) => [u.id, u.name]));
  const jobRatingsData = job.ratings.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: r.employee.name,
    rating: r.rating,
    notes: r.notes,
    raterName: r.ratedBy ? staffById.get(r.ratedBy) ?? null : null,
    createdAt: r.createdAt.toISOString(),
    // Item 5: an excluded rating stays visible here (with who pulled it and
    // why) while counting for nothing in the cleaner's score.
    excludedAt: r.excludedAt ? r.excludedAt.toISOString() : null,
    excludedByName: r.excludedById ? staffById.get(r.excludedById) ?? null : null,
    excludedReason: r.excludedReason,
  }));

  return (
    <JobDetailView
      job={jobData}
      productUsage={productUsageData}
      logs={logsData}
      photos={photosData}
      reviewPhotos={reviewPhotosData}
      totalLogs={totalLogs}
      logsPage={logsPage}
      logsPerPage={logsPerPage}
      totalProductCost={totalProductCost}
      taxRates={taxRates}
      isAdmin={isAdmin}
      onDeleteJob={deleteJob}
      users={users}
      clients={clients}
      currentUserName={session.user.name ?? undefined}
      assignments={assignmentsData}
      payShares={payShares}
      payOverrides={payOverrides}
      jobRatings={jobRatingsData}
      gpsEnabled={gpsEnabled}
    />
  );
}

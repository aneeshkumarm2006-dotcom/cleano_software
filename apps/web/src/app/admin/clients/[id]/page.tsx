import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/org-db";
import { jobRevenue } from "@/lib/metrics";
import { activeSubtotal } from "@/lib/job-money";
import ClientDetailView from "./ClientDetailView";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const role = (session.user as any).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    redirect("/admin/dashboard");
  }

  const client = await db.client.findUnique({
    where: { id },
    include: {
      jobs: {
        orderBy: { startTime: "desc" },
        include: {
          cleaners: { select: { id: true, name: true } },
          // This client's lifetime revenue is the sum of ACTIVE subtotals
          // (fix 3), which needs the add-on rows.
          addOns: { select: { name: true, price: true, quantity: true } },
        },
      },
      addresses: { orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] },
    },
  });

  const jobIds = client?.jobs.map((j) => j.id) ?? [];

  if (!client) redirect("/admin/clients");

  const rawRatings = await db.employeeRating.findMany({
    // Excluded ratings don't count toward the shown average (item 5); they
    // stay visible on the job they belong to.
    where: { jobId: { in: jobIds }, excludedAt: null },
    include: {
      employee: { select: { id: true, name: true } },
      job: { select: { id: true, jobNumber: true, jobDate: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const jobs = client.jobs.map((j) => ({
    id: j.id,
    clientName: j.clientName,
    location: j.location,
    jobType: j.jobType,
    jobDate: j.jobDate?.toISOString() || null,
    startTime: j.startTime.toISOString(),
    endTime: j.endTime?.toISOString() || null,
    status: j.status,
    // The ACTIVE value of the job, not the bare base line (fix 3). This list
    // and the totals under it are what a client's history is worth, so an
    // add-on job has to read $186 here exactly as it does on the job page.
    price: activeSubtotal(j),
    employeePay: j.employeePay,
    totalTip: j.totalTip,
    parking: j.parking,
    paymentReceived: j.paymentReceived,
    invoiceSent: j.invoiceSent,
    notes: j.notes,
    paymentType: j.paymentType,
    discountAmount: j.discountAmount,
    cleaners: j.cleaners,
  }));

  // Canonical revenue for this client: completed+paid only, discount/refund
  // applied, tax excluded, soft-deleted jobs excluded (computed from the raw
  // Job rows so refundedAmount/deletedAt are available). totalPaid/unpaidAmount
  // keep their prior meaning below.
  const totalRevenue = client.jobs
    .filter(
      (j) =>
        j.deletedAt === null &&
        j.paymentReceived &&
        (j.status === "COMPLETED" || j.status === "PAID")
    )
    .reduce((sum, j) => sum + jobRevenue(j), 0);
  const totalPaid = jobs
    .filter((j) => j.paymentReceived)
    .reduce((sum, j) => sum + (j.price || 0), 0);
  const unpaidAmount = jobs
    .filter((j) => j.status === "COMPLETED" && !j.paymentReceived)
    .reduce((sum, j) => sum + (j.price || 0), 0);

  const ratings = rawRatings.map((r) => ({
    id: r.id,
    rating: r.rating,
    notes: r.notes,
    ratedBy: r.ratedBy,
    createdAt: r.createdAt.toISOString(),
    employee: r.employee,
    job: r.job
      ? {
          id: r.job.id,
          jobNumber: r.job.jobNumber,
          jobDate: r.job.jobDate?.toISOString() ?? null,
        }
      : null,
  }));

  return (
    <div className="h-full overflow-y-auto p-8">
      <ClientDetailView
        client={{
          id: client.id,
          name: client.name,
          email: client.email,
          secondaryEmail: client.secondaryEmail,
          phone: client.phone,
          secondaryPhone: client.secondaryPhone,
          company: client.company,
          address: client.address,
          aptNumber: client.aptNumber,
          city: client.city,
          state: client.state,
          zip: client.zip,
          notes: client.notes,
          discountPercent: client.discountPercent,
          fixedPrice: client.fixedPrice,
          fixedPriceRecurring: client.fixedPriceRecurring,
          fixedPriceAllowFrequencyDiscount:
            client.fixedPriceAllowFrequencyDiscount,
          createdAt: client.createdAt.toISOString(),
          addresses: client.addresses.map((a) => ({
            id: a.id,
            label: a.label,
            address: a.address,
            aptNumber: a.aptNumber,
            city: a.city,
            postalCode: a.postalCode,
            accessNotes: a.accessNotes,
            // Property size lives on the address since item 3 — the manager
            // edits it here, and the job forms read it back from the same row.
            propertyType: a.propertyType,
            bedCount: a.bedCount,
            bathCount: a.bathCount,
            halfBathCount: a.halfBathCount,
            squareFootage: a.squareFootage,
            isDefault: a.isDefault,
          })),
        }}
        jobs={jobs}
        totals={{ totalRevenue, totalPaid, unpaidAmount, jobCount: jobs.length }}
        ratings={ratings}
      />
    </div>
  );
}

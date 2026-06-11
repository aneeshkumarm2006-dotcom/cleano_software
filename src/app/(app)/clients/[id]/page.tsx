import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
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
    redirect("/dashboard");
  }

  const client = await db.client.findUnique({
    where: { id },
    include: {
      jobs: {
        orderBy: { startTime: "desc" },
        include: { cleaners: { select: { id: true, name: true } } },
      },
      addresses: { orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] },
    },
  });

  const jobIds = client?.jobs.map((j) => j.id) ?? [];

  if (!client) redirect("/clients");

  const rawRatings = await db.employeeRating.findMany({
    where: { jobId: { in: jobIds } },
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
    price: j.price,
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

  const totalRevenue = jobs.reduce((sum, j) => sum + (j.price || 0), 0);
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
          createdAt: client.createdAt.toISOString(),
          addresses: client.addresses.map((a) => ({
            id: a.id,
            label: a.label,
            address: a.address,
            aptNumber: a.aptNumber,
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

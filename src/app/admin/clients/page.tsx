import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { jobRevenue, ACTIVE_VALUE_SELECT } from "@/lib/metrics";
import ClientsPageClient from "./ClientsPageClient";

type SearchParams = Promise<{
  [key: string]: string | string[] | undefined;
}>;

// Allow bulk CSV import (processed by the importCsv server action) enough time.
export const maxDuration = 60;

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const role = (session.user as any).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    redirect("/admin/dashboard");
  }

  const params = await searchParams;
  const search = (params.search as string) || "";
  const page = Number(params.page) || 1;
  const rowsPerPage = Number(params.rowsPerPage) || 10;
  const archived = params.archived === "1";

  const clients = await db.client.findMany({
    where: { deletedAt: archived ? { not: null } : null },
    orderBy: { name: "asc" },
    include: {
      jobs: {
        select: {
          // Fix 3: revenue is the ACTIVE subtotal, so every column that decides
          // it — including the add-on rows — travels with the job. The spread
          // is the shared fragment; forgetting it is a type error.
          ...ACTIVE_VALUE_SELECT,
          id: true,
          refundedAmount: true,
          paymentReceived: true,
          status: true,
          deletedAt: true,
          jobDate: true,
          startTime: true,
        },
      },
    },
  });

  const clientsData = clients.map((c) => {
    const totalJobs = c.jobs.length;
    const completedJobs = c.jobs.filter((j) => j.status === "COMPLETED").length;
    // Canonical revenue: completed+paid, discount/refund applied, tax excluded,
    // soft-deleted jobs excluded — matches Dashboard/Analytics/Employees.
    const totalRevenue = c.jobs
      .filter(
        (j) =>
          j.deletedAt === null &&
          j.paymentReceived &&
          (j.status === "COMPLETED" || j.status === "PAID")
      )
      .reduce((sum, j) => sum + jobRevenue(j), 0);
    const unpaidJobs = c.jobs.filter(
      (j) => j.status === "COMPLETED" && !j.paymentReceived
    ).length;
    const lastJobDate = c.jobs.reduce<Date | null>((acc, j) => {
      const d = j.jobDate ?? j.startTime;
      if (!d) return acc;
      if (!acc || new Date(d) > acc) return new Date(d);
      return acc;
    }, null);

    return {
      id: c.id,
      name: c.name,
      email: c.email,
      secondaryEmail: c.secondaryEmail,
      phone: c.phone,
      secondaryPhone: c.secondaryPhone,
      company: c.company,
      address: c.address,
      aptNumber: c.aptNumber,
      city: c.city,
      state: c.state,
      zip: c.zip,
      notes: c.notes,
      discountPercent: c.discountPercent,
      fixedPrice: c.fixedPrice,
      fixedPriceRecurring: c.fixedPriceRecurring,
      fixedPriceAllowFrequencyDiscount: c.fixedPriceAllowFrequencyDiscount,
      isActive: c.isActive,
      totalJobs,
      completedJobs,
      totalRevenue,
      unpaidJobs,
      lastJobDate: lastJobDate ? lastJobDate.toISOString() : null,
    };
  });

  const stats = {
    totalClients: clientsData.length,
    totalRevenue: clientsData.reduce((sum, c) => sum + c.totalRevenue, 0),
    activeClients: clientsData.filter((c) => c.totalJobs > 0).length,
    unpaidJobs: clientsData.reduce((sum, c) => sum + c.unpaidJobs, 0),
  };

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <ClientsPageClient
        initialClients={clientsData}
        initialStats={stats}
        initialSearch={search}
        initialPage={page}
        initialRowsPerPage={rowsPerPage}
        archived={archived}
      />
    </div>
  );
}

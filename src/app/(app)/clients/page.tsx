import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import ClientsPageClient from "./ClientsPageClient";

type SearchParams = Promise<{
  [key: string]: string | string[] | undefined;
}>;

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const role = (session.user as any).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const search = (params.search as string) || "";
  const page = Number(params.page) || 1;
  const rowsPerPage = Number(params.rowsPerPage) || 10;

  const clients = await db.client.findMany({
    orderBy: { name: "asc" },
    include: {
      jobs: {
        select: {
          id: true,
          price: true,
          paymentReceived: true,
          status: true,
          jobDate: true,
          startTime: true,
        },
      },
    },
  });

  const clientsData = clients.map((c) => {
    const totalJobs = c.jobs.length;
    const completedJobs = c.jobs.filter((j) => j.status === "COMPLETED").length;
    const totalRevenue = c.jobs.reduce((sum, j) => sum + (j.price || 0), 0);
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
      phone: c.phone,
      address: c.address,
      notes: c.notes,
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
      />
    </div>
  );
}

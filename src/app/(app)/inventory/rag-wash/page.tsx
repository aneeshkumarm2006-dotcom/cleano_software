import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import RagWashClient from "./RagWashClient";

export default async function RagWashPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const userRole = (session.user as any).role;
  if (userRole !== "OWNER" && userRole !== "ADMIN") {
    redirect("/dashboard");
  }

  // Fetch all employees with their rag wash data
  const employees = await db.user.findMany({
    orderBy: { name: "asc" },
    include: {
      ragWashes: {
        orderBy: { washDate: "desc" },
        take: 1,
      },
      _count: {
        select: { ragWashes: true },
      },
    },
  });

  // Aggregate stats per employee
  const ragWashStats = await db.ragWash.groupBy({
    by: ["employeeId"],
    _sum: { ragCount: true },
    _count: true,
  });

  const statsMap = new Map(
    ragWashStats.map((s) => [
      s.employeeId,
      { totalRags: s._sum.ragCount || 0, totalWashes: s._count },
    ])
  );

  const employeeData = employees.map((emp) => {
    const stats = statsMap.get(emp.id);
    const lastWash = emp.ragWashes[0];
    return {
      id: emp.id,
      name: emp.name,
      email: emp.email,
      role: emp.role,
      totalWashes: stats?.totalWashes || 0,
      totalRags: stats?.totalRags || 0,
      lastWashDate: lastWash?.washDate.toISOString() || null,
      lastWashRagCount: lastWash?.ragCount || 0,
    };
  });

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <RagWashClient employees={employeeData} />
    </div>
  );
}

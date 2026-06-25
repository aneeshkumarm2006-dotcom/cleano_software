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
    redirect("/admin/dashboard");
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
      <div style={{ display: "flex", gap: 0, marginBottom: 24, borderBottom: "1px solid rgba(0,140,156,0.1)" }}>
        <a href="/admin/inventory/rag-wash" style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, color: "#008C9C", textDecoration: "none", borderBottom: "2px solid #008C9C", marginBottom: -1, display: "inline-block" }}>Rag Wash</a>
        <a href="/admin/wash-payouts" style={{ padding: "8px 18px", fontSize: 13, fontWeight: 400, color: "rgba(0,140,156,0.5)", textDecoration: "none", borderBottom: "2px solid transparent", marginBottom: -1, display: "inline-block" }}>Wash Payouts</a>
      </div>
      <RagWashClient employees={employeeData} />
    </div>
  );
}

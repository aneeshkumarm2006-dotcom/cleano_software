import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import RagWashDetailView from "./RagWashDetailView";

export default async function RagWashDetailPage({
  params,
}: {
  params: Promise<{ employeeId: string }>;
}) {
  const { employeeId } = await params;

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

  const employee = await db.user.findUnique({
    where: { id: employeeId },
    select: { id: true, name: true, email: true },
  });

  if (!employee) {
    redirect("/inventory/rag-wash");
  }

  const ragWashes = await db.ragWash.findMany({
    where: { employeeId },
    orderBy: { washDate: "desc" },
  });

  const totalRags = ragWashes.reduce((sum, w) => sum + w.ragCount, 0);

  const washData = ragWashes.map((w) => ({
    id: w.id,
    washDate: w.washDate.toISOString(),
    ragCount: w.ragCount,
    notes: w.notes,
  }));

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <RagWashDetailView
        employee={{ id: employee.id, name: employee.name, email: employee.email }}
        washes={washData}
        totalRags={totalRags}
        totalWashes={ragWashes.length}
      />
    </div>
  );
}

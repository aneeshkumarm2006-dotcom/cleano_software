import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCpaReport } from "@/lib/cpa";
import ReportsView from "./ReportsView";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    redirect("/dashboard");
  }

  const report = await getCpaReport();

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <ReportsView report={report} />
    </div>
  );
}

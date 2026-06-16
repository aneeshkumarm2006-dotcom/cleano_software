import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { listDuplicateGroups } from "@/lib/crm";
import DuplicatesView from "./DuplicatesView";

export const dynamic = "force-dynamic";

export default async function DuplicatesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    redirect("/dashboard");
  }

  const groups = await listDuplicateGroups();

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <DuplicatesView groups={groups} />
    </div>
  );
}

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { listPropertyDefinitions } from "@/lib/prop-engine";
import PropertyEngineView from "./PropertyEngineView";

export const dynamic = "force-dynamic";

export default async function PropertiesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    redirect("/admin/dashboard");
  }

  const properties = await listPropertyDefinitions();

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <PropertyEngineView properties={properties} />
    </div>
  );
}

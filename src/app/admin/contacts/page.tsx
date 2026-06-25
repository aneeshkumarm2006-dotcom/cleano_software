import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { listContacts, computeStats } from "@/lib/crm";
import ContactsPageClient from "./ContactsPageClient";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    redirect("/admin/dashboard");
  }

  const contacts = await listContacts();
  const stats = computeStats(contacts);

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <ContactsPageClient initialContacts={contacts} initialStats={stats} currentUserId={session.user.id} />
    </div>
  );
}

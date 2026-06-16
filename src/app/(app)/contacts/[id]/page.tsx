import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getContact } from "@/lib/crm";
import { listObjectProperties } from "@/lib/prop-engine";
import ContactDetailView from "./ContactDetailView";

export const dynamic = "force-dynamic";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    redirect("/dashboard");
  }

  const { id } = await params;
  const [contact, propertyDefs] = await Promise.all([
    getContact(id),
    listObjectProperties("contact"),
  ]);
  if (!contact) notFound();

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <ContactDetailView contact={contact} propertyDefs={propertyDefs} />
    </div>
  );
}

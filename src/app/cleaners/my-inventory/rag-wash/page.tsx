import { redirect } from "next/navigation";
import { requireSession } from "@/lib/page-guards";
import { isAdminRole } from "@/lib/role-routing";

/**
 * The rag-wash system was removed (spec item 23) — payouts and history remain
 * at /admin/wash-payouts. This guarded redirect keeps lingering links from
 * 404-ing: cleaners land on their inventory, admins on Wash Payouts.
 */
export default async function CleanerRagWashRedirect() {
  const session = await requireSession();
  const role = (session.user as { role?: string }).role;

  if (isAdminRole(role)) {
    redirect("/admin/wash-payouts");
  }
  redirect("/cleaners/my-inventory");
}

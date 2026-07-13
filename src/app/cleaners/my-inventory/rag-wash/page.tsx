import { redirect } from "next/navigation";
import { requireSession } from "@/lib/page-guards";
import { isAdminRole } from "@/lib/role-routing";

/**
 * The cleaner-facing rag-wash screen (wash logging + payout claiming) has been
 * removed: rag-wash logging is admin-controlled only, from
 * /admin/inventory/rag-wash and /admin/wash-payouts.
 *
 * The route is kept as a guarded redirect rather than deleted outright so that
 * any lingering link lands somewhere sensible instead of 404-ing. Cleaners are
 * bounced to their inventory; admins are sent to the admin rag-wash screen.
 */
export default async function CleanerRagWashRedirect() {
  const session = await requireSession();
  const role = (session.user as { role?: string }).role;

  if (isAdminRole(role)) {
    redirect("/admin/inventory/rag-wash");
  }
  redirect("/cleaners/my-inventory");
}

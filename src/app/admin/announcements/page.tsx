import { requireAdmin } from "@/lib/page-guards";
import AnnouncementsClient from "./AnnouncementsClient";
import { listAnnouncements } from "./announcements";

export const metadata = {
  title: "Announcements · Cleano",
};

export default async function AnnouncementsPage() {
  const session = await requireAdmin();
  const role = (session.user as { role?: string }).role;
  // FIELD_LEAD gets the admin app but cannot publish — server actions enforce
  // the same rule; this only hides the manage UI.
  const canManage =
    role === "OWNER" || role === "ADMIN" || role === "OPS_MANAGER";

  const res = await listAnnouncements();

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <AnnouncementsClient
        initial={res.success ? res.data : []}
        canManage={canManage}
      />
    </div>
  );
}

import { requireCleaner } from "@/lib/page-guards";
import AnnouncementsClient from "@/app/admin/announcements/AnnouncementsClient";
import { listAnnouncements } from "@/app/admin/announcements/announcements";

export const metadata = {
  title: "Announcements · Cleano",
};

// Cleaner-facing announcements: read-only feed + reactions. Publishing,
// editing, pinning, and deleting stay admin-only (canManage=false and the
// server actions enforce it regardless).
export default async function CleanerAnnouncementsPage() {
  await requireCleaner();

  const res = await listAnnouncements();

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <AnnouncementsClient
        initial={res.success ? res.data : []}
        canManage={false}
      />
    </div>
  );
}

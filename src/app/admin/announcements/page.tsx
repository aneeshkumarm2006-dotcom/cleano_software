import { requireAdmin } from "@/lib/page-guards";
import AnnouncementsClient from "./AnnouncementsClient";

export const metadata = {
  title: "Announcements · Cleano",
};

export default async function AnnouncementsPage() {
  await requireAdmin();

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <AnnouncementsClient />
    </div>
  );
}

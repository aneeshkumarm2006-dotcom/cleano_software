import { requireAdmin } from "@/lib/page-guards";
import { listAdminNotifications } from "@/lib/admin-notifications";

import NotificationsClient from "./NotificationsClient";

export const metadata = { title: "Notifications · Awer" };

/**
 * What has happened that an admin should know about.
 *
 * Deliberately a record of EVENTS rather than of emails: a row lands here
 * whether or not the email was enabled or delivered, so "we never heard about
 * it" can be answered by looking rather than by guessing which toggle is off.
 */
export default async function AdminNotificationsPage() {
  const session = await requireAdmin();
  const items = await listAdminNotifications(session.user.id);

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Notifications</h1>
        <p className="mt-1 text-sm text-gray-500">
          Everything worth knowing about, kept here even when the matching email is
          switched off.
        </p>
      </div>
      <NotificationsClient initial={items} />
    </div>
  );
}

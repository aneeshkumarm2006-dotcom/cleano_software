import { requireAdmin } from "@/lib/page-guards";
import { listAdminNotifications } from "@/lib/admin-notifications";

import { listTimeLogRequests } from "../actions/decideTimeLogChange";

import NotificationsClient from "./NotificationsClient";
import TimeLogRequestsPanel from "./TimeLogRequestsPanel";
import StaleClocksPanel from "./StaleClocksPanel";
import { listStaleClocksForAdmin } from "../actions/closeStaleClock";

export const metadata = { title: "Notifications" };

/**
 * What has happened that an admin should know about.
 *
 * Deliberately a record of EVENTS rather than of emails: a row lands here
 * whether or not the email was enabled or delivered, so "we never heard about
 * it" can be answered by looking rather than by guessing which toggle is off.
 */
export default async function AdminNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; timelog?: string }>;
}) {
  const session = await requireAdmin();
  // The Archived view asks for the rows the default feed hides (item 13).
  const params = await searchParams;
  const view = params.view;
  const items = await listAdminNotifications(
    session.user.id,
    50,
    view === "archived"
  );
  // Sept 17, item 19. Waiting requests only by default: they are the ones
  // somebody is waiting on. `?timelog=all` opens the history the PDF asks to
  // be kept.
  const timelogHistory = params.timelog === "all";
  const timeLogRequests = await listTimeLogRequests(timelogHistory);

  // Clocks nobody stopped. Above the requests queue because these have been
  // wrong for longer and nobody is chasing them: a cleaner chases their own
  // time-log request, while a session left running has no advocate, which is
  // how one of them reached thirty-four days.
  const staleClocks = await listStaleClocksForAdmin();

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Notifications</h1>
        <p className="mt-1 text-sm text-gray-500">
          Everything worth knowing about, kept here even when the matching email is
          switched off.
        </p>
      </div>
      <StaleClocksPanel rows={staleClocks} compact />
      <TimeLogRequestsPanel
        rows={timeLogRequests}
        showingHistory={timelogHistory}
      />
      <NotificationsClient initial={items} archivedView={view === "archived"} />
    </div>
  );
}

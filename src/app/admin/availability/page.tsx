import { requireOwnerAdmin } from "@/lib/page-guards";
import { getAvailabilityBoard } from "../actions/getAvailabilityBoard";
import AvailabilityBoardClient from "./AvailabilityBoardClient";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * /admin/availability — the all-cleaner availability view
 * (cleano_inventory_operations_fixes PDF #12, p.8 / Stage 12).
 *
 * "One central view shows all cleaner availability — no per-profile clicking."
 * Before this page an admin answering "who can work Tuesday morning?" either
 * opened cleaners one at a time or read a collapsed weekday table on the
 * Employees page that could not speak about a specific date at all.
 *
 * READ-ONLY (step 12.4 / decision D12). Every row links to
 * `/admin/employees/{id}?tab=availability`, which is where editing lives and
 * stays — this page grants no new write permission and reaches no write action.
 *
 * OWNER/ADMIN only, matching the `adminOnly: true` nav entry in
 * `src/app/admin/Sidebar.tsx`. A Field Lead's group-scoped equivalent is
 * /admin/my-team; the action authorizes independently for the same reason.
 *
 * Filters live in the URL, so the view is shareable, survives a refresh, and can
 * be deep-linked into from the job form's availability advisory (step 12.5).
 */
export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireOwnerAdmin();

  const params = await searchParams;
  const result = await getAvailabilityBoard(params);

  if (!result.success) {
    return (
      <div className="admin-font h-full overflow-hidden overflow-y-auto p-8 stack-24">
        <header className="stack-8">
          <p className="eyebrow">Staff</p>
          <h1 className="display">Availability</h1>
        </header>
        <div className="dcard" style={{ padding: 20 }}>
          <p className="text-sm text-red-600">{result.error}</p>
        </div>
      </div>
    );
  }

  return <AvailabilityBoardClient board={result.board} />;
}

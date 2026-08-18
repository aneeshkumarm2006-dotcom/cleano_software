import { requireOwnerAdmin } from "@/lib/page-guards";
import RecurringClient from "./RecurringClient";

export const metadata = {
  title: "Recurring Reschedule · Cleano",
};

export default async function RecurringPage() {
  // requireOwnerAdmin, NOT requireAdmin: `isAdminRole` also admits
  // OPS_MANAGER and FIELD_LEAD, and this page prints money.
  await requireOwnerAdmin();

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <RecurringClient />
    </div>
  );
}

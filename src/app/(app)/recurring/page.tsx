import { requireAdmin } from "@/lib/page-guards";
import RecurringClient from "./RecurringClient";

export const metadata = {
  title: "Recurring Reschedule · Cleano",
};

export default async function RecurringPage() {
  await requireAdmin();

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <RecurringClient />
    </div>
  );
}

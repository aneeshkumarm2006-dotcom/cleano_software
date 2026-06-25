import { requireAdmin } from "@/lib/page-guards";
import RetentionKpiClient from "./RetentionKpiClient";

export default async function KpiPage() {
  await requireAdmin();
  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <RetentionKpiClient />
    </div>
  );
}

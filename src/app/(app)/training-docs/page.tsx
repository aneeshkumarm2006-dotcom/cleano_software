import { requireAdmin } from "@/lib/page-guards";
import TrainingDocsClient from "./TrainingDocsClient";

export const metadata = {
  title: "Training & Documents · Cleano",
};

export default async function TrainingDocsPage() {
  await requireAdmin();

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <TrainingDocsClient />
    </div>
  );
}

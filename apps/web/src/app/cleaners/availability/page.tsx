import { requireCleaner } from "@/lib/page-guards";
import AvailabilityTab from "@/app/admin/settings/tabs/AvailabilityTab";

export default async function AvailabilityPage() {
  const session = await requireCleaner();

  return (
    <div className="cl-page-wrap">
      <div className="cl-page-head">
        <div>
          <h1 className="cl-page-title">My availability</h1>
          <p className="cl-page-sub">
            Set the days and times you&apos;re available to clean, and block off
            days you can&apos;t work.
          </p>
        </div>
      </div>
      <AvailabilityTab employeeId={session.user.id} />
    </div>
  );
}

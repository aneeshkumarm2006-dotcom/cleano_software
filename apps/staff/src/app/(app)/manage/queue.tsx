import { Guarded } from "@/components/Guarded";
import { useApprovalsSummary } from "@/data/queries";
import { useStaffRole } from "@/data/role";
import { ApprovalsBody } from "@/features/manage/Approvals";
import { BackHeader, Page } from "@/features/record/ui";

/**
 * Approvals, opened from More: a field lead's clock-time queue (the office
 * roles have it as a tab). The web lets a field lead decide time changes,
 * and nothing else here.
 */
export default function QueueScreen() {
  return (
    <Guarded need={["TIME_APPROVE", "WITHDRAWALS", "KIT_REQUESTS"]}>
      <Queue />
    </Guarded>
  );
}

function Queue() {
  const role = useStaffRole();
  const summary = useApprovalsSummary();
  return (
    <Page header={<BackHeader title="Approvals" fallback={role.home} />} refreshing={summary.isRefetching} onRefresh={() => summary.refetch()}>
      <ApprovalsBody />
    </Page>
  );
}

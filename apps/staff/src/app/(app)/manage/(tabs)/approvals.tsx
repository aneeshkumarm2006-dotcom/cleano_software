import { Screen, TAB_BAR_HEIGHT } from "@bookmops/ui-native";

import { Guarded } from "@/components/Guarded";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useApprovalsSummary } from "@/data/queries";
import { ApprovalsBody } from "@/features/manage/Approvals";

/** What's waiting on the office: clock times, withdrawals, kit restocks. */
export default function ApprovalsTab() {
  return (
    <Guarded need={["TIME_APPROVE", "WITHDRAWALS", "KIT_REQUESTS"]}>
      <Approvals />
    </Guarded>
  );
}

function Approvals() {
  const summary = useApprovalsSummary();
  return (
    <Screen header={<ScreenHeader title="Approvals" />} bottomInset={TAB_BAR_HEIGHT} refreshing={summary.isRefetching} onRefresh={() => summary.refetch()}>
      <ApprovalsBody />
    </Screen>
  );
}

import { Screen, TAB_BAR_HEIGHT } from "@bookmops/ui-native";

import { Empty } from "@/components/QueryState";
import { ScreenHeader } from "@/components/ScreenHeader";

export default function PayTab() {
  return (
    <Screen header={<ScreenHeader title="My pay" />} bottomInset={TAB_BAR_HEIGHT}>
      <Empty
        icon="pay"
        title="Coming in the next update"
        detail="Your earnings, payouts and withdrawals will be here."
      />
    </Screen>
  );
}

import { Screen, TAB_BAR_HEIGHT } from "@bookmops/ui-native";

import { Empty } from "@/components/QueryState";
import { ScreenHeader } from "@/components/ScreenHeader";

export default function AvailableTab() {
  return (
    <Screen header={<ScreenHeader title="Available jobs" />} bottomInset={TAB_BAR_HEIGHT}>
      <Empty
        icon="available"
        title="Coming in the next update"
        detail="Open jobs you can claim will be listed here."
      />
    </Screen>
  );
}

import { color, Icon, radius, space, TAB_BAR_HEIGHT, Text } from "@bookmops/ui-native";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useOutbox } from "@/data/outbox";

/**
 * Tells the person when their taps haven't reached the office: something was
 * refused, or sending is paused. Quiet while things are simply waiting for
 * signal — the clock screen shows that — and gone once all is sent.
 */
export function SyncNotice() {
  const insets = useSafeAreaInsets();
  const { failed, paused, retry } = useOutbox();
  if (failed.length === 0 && !paused) return null;

  const message = paused === "update-required"
    ? "Update the app to send your clock times."
    : paused === "signed-out"
      ? "Sign in again to send your clock times."
      : failed.length === 1
        ? `The office couldn't take one of your updates: ${failed[0]!.error ?? "no reason given"}.`
        : `The office couldn't take ${failed.length} of your updates.`;

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: space[4], right: space[4], bottom: Math.max(insets.bottom, space[3]) + TAB_BAR_HEIGHT + space[2] }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${message} ${failed.length ? "Tap to try again." : ""}`}
        accessibilityLiveRegion="polite"
        disabled={failed.length === 0}
        onPress={retry}
        style={{ flexDirection: "row", alignItems: "center", gap: space[3], padding: space[3], borderRadius: radius.lg, backgroundColor: color.warningSoft}}
      >
        <Icon name="warning" size={20} color="warning" />
        <Text variant="small" weight="semibold" color="warning" style={{ flex: 1 }}>
          {message}
        </Text>
        {failed.length ? (
          <Text variant="small" weight="bold" color="warning">
            Try again
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

import { color, minTouch, radius, space, Text } from "@bookmops/ui-native";
import { type AccessibilityActionEvent, Pressable, View } from "react-native";

import { clockTime } from "@/lib/format";

const STEP_MS = 5 * 60_000;

/**
 * A clock time moved five minutes at a time, with big targets, as the
 * availability screen's TimeField moves half hours. It works on the instant
 * itself, so the day and the company's zone never have to be rebuilt from
 * a wall-clock string. VoiceOver and TalkBack adjust it with a swipe.
 */
export function TimeStepper({
  label,
  value,
  onChange,
  timeZone,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  timeZone: string;
}) {
  const move = (dir: 1 | -1) => onChange(new Date(new Date(value).getTime() + dir * STEP_MS).toISOString());
  const button = (dir: 1 | -1) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: five minutes ${dir === 1 ? "later" : "earlier"}`}
      onPress={() => move(dir)}
      style={({ pressed }) => ({
        width: minTouch + 4,
        height: minTouch + 4,
        borderRadius: radius.md,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? color.groundDeep : color.surface,
        borderWidth: 1,
        borderColor: color.lineStrong,
      })}
    >
      <Text variant="heading" color="chrome">
        {dir === 1 ? "+" : "−"}
      </Text>
    </Pressable>
  );
  const shown = clockTime(value, timeZone);
  return (
    <View style={{ flex: 1, gap: space[2] }}>
      <Text variant="eyebrow" color="ink3">
        {label}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        {button(-1)}
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ text: shown }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(e: AccessibilityActionEvent) => move(e.nativeEvent.actionName === "increment" ? 1 : -1)}
          style={{ flex: 1, alignItems: "center" }}
        >
          <Text variant="heading" color="chrome" numeral>
            {shown}
          </Text>
        </View>
        {button(1)}
      </View>
    </View>
  );
}

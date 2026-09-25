import { color, minTouch, radius, space, Text } from "@bookmops/ui-native";
import { Pressable, View } from "react-native";

import { LAST, show, step, toMinutes } from "./time";

/** A time, moved half an hour at a time with big targets. */
export function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const button = (dir: 1 | -1) => {
    const disabled = dir === -1 ? toMinutes(value) <= 0 : toMinutes(value) >= LAST;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${dir === 1 ? "half an hour later" : "half an hour earlier"}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => onChange(step(value, dir))}
        style={({ pressed }) => ({
          width: minTouch + 4,
          height: minTouch + 4,
          borderRadius: radius.md,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: pressed ? color.groundDeep : color.surface,
          borderWidth: 1,
          borderColor: color.lineStrong,
          opacity: disabled ? 0.4 : 1,
        })}
      >
        <Text variant="heading" color="chrome">
          {dir === 1 ? "+" : "−"}
        </Text>
      </Pressable>
    );
  };
  return (
    <View style={{ flex: 1, gap: space[2] }}>
      <Text variant="eyebrow" color="ink3" style={{ fontSize: 10 }}>
        {label}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        {button(-1)}
        <View accessible accessibilityLabel={`${label}: ${show(value)}`} style={{ flex: 1, alignItems: "center" }}>
          <Text variant="heading" color="chrome" numeral>
            {show(value)}
          </Text>
        </View>
        {button(1)}
      </View>
    </View>
  );
}

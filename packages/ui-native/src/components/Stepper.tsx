import { Pressable, View } from "react-native";

import { color, minTouch, radius, space } from "../tokens";
import { Text } from "./Text";

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Read out with the number: "Microfibre cloths". */
  label: string;
  unit?: string;
}

/** A count, changed one at a time with big targets — for a thumb, mid-shift. */
export function Stepper({ value, onChange, min = 0, max = 1000, label, unit }: StepperProps) {
  const button = (icon: "remove" | "add", next: number, disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${icon === "add" ? "One more" : "One less"} ${label}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => onChange(next)}
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
        {icon === "add" ? "+" : "−"}
      </Text>
    </Pressable>
  );
  return (
    <View
      accessible={false}
      style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}
    >
      {button("remove", Math.max(min, value - 1), value <= min)}
      <View accessible accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ""}`} style={{ minWidth: 56, alignItems: "center" }}>
        <Text variant="heading" numeral color="chrome">
          {value}
        </Text>
        {unit ? (
          <Text variant="small" color="ink3">
            {unit}
          </Text>
        ) : null}
      </View>
      {button("add", Math.min(max, value + 1), value >= max)}
    </View>
  );
}

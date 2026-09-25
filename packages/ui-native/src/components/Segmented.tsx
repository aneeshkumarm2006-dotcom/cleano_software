import { Pressable, View } from "react-native";

import { color, minTouch, radius, space } from "../tokens";
import { Text } from "./Text";

export interface SegmentedProps<T extends string> {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** What the choice is about, for screen readers ("Which jobs"). */
  label: string;
}

/** A small set of mutually exclusive views of one list. */
export function Segmented<T extends string>({ options, value, onChange, label }: SegmentedProps<T>) {
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={{ flexDirection: "row", padding: 4, gap: 4, borderRadius: radius.lg, backgroundColor: color.groundDeep }}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              minHeight: minTouch - 4,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: space[3],
              borderRadius: radius.md - 2,
              backgroundColor: selected ? color.surface : "transparent",
              borderWidth: selected ? 1 : 0,
              borderColor: color.line,
            }}
          >
            <Text variant="small" weight={selected ? "bold" : "semibold"} color={selected ? "chrome" : "ink2"}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

import { Pressable, View } from "react-native";

import { color, minTouch, radius, space } from "../tokens";
import { Text } from "./Text";

export interface ChoiceChipsProps<T extends string> {
  options: readonly { value: T; label: string; tone?: "ok" | "warn" | "bad" }[];
  value: T | null;
  onChange: (value: T) => void;
  /** What is being chosen, for screen readers ("Level of All-purpose cleaner"). */
  label: string;
}

const TONE = {
  ok: { bg: color.successSoft, fg: "success", border: color.success },
  warn: { bg: color.warningSoft, fg: "warning", border: color.warning },
  bad: { bg: color.dangerSoft, fg: "danger", border: color.danger },
} as const;

/** One choice from a short list, as tappable chips that wrap. */
export function ChoiceChips<T extends string>({ options, value, onChange, label }: ChoiceChipsProps<T>) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
      {options.map((o) => {
        const selected = o.value === value;
        const tone = TONE[o.tone ?? "ok"];
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={{
              minHeight: minTouch,
              paddingHorizontal: space[4],
              justifyContent: "center",
              borderRadius: radius.pill,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? tone.border : color.lineStrong,
              backgroundColor: selected ? tone.bg : color.surface,
            }}
          >
            <Text variant="small" weight={selected ? "bold" : "semibold"} color={selected ? tone.fg : "ink2"}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

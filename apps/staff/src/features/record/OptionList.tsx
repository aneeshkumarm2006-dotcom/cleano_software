import { color, Icon, minTouch, radius, space, Text } from "@bookmops/ui-native";
import { Pressable, View } from "react-native";

export interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/**
 * One choice from a few, each with a hint so the right one gets picked
 * ("Lost — can't find it"). The chosen one is filled with the chrome colour.
 */
export function OptionList<T extends string>({
  options,
  value,
  onChange,
  label,
  columns = 1,
}: {
  options: readonly Option<T>[];
  value: T | null;
  onChange: (value: T) => void;
  label: string;
  columns?: 1 | 2;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={o.hint ? `${o.label}, ${o.hint}` : o.label}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => ({
              flexBasis: columns === 2 ? "48%" : "100%",
              flexGrow: 1,
              minHeight: minTouch + 12,
              paddingHorizontal: space[4],
              paddingVertical: space[3],
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: selected ? color.chrome : color.line,
              backgroundColor: selected ? color.chrome : pressed ? color.groundDeep : color.surface,
              flexDirection: "row",
              alignItems: "center",
              gap: space[3],
            })}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong" color={selected ? "onChrome" : "ink"}>
                {o.label}
              </Text>
              {o.hint ? (
                <Text variant="small" color={selected ? "onChrome2" : "ink2"}>
                  {o.hint}
                </Text>
              ) : null}
            </View>
            {selected ? <Icon name="check" size={20} color="onChrome" /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { color, minTouch, radius, space } from "../tokens";
import { Icon } from "./Icon";
import { Text } from "./Text";

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The words next to the box. The whole row toggles. */
  children: ReactNode;
  /** Read out instead of the children, when they aren't plain text. */
  accessibilityLabel?: string;
  disabled?: boolean;
}

/** A box and a sentence, for an explicit "yes, I agree". */
export function Checkbox({ checked, onChange, children, accessibilityLabel, disabled }: CheckboxProps) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={{ minHeight: minTouch, flexDirection: "row", alignItems: "flex-start", gap: space[3], paddingVertical: space[1] }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          marginTop: 1,
          borderRadius: radius.sm - 3,
          borderWidth: 2,
          borderColor: checked ? color.chrome : color.accent,
          backgroundColor: checked ? color.chrome : color.surface,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {checked ? <Icon name="tick" size={16} color="onChrome" /> : null}
      </View>
      <View style={{ flex: 1 }}>
        {typeof children === "string" ? (
          <Text variant="small" color="ink2" style={{ fontSize: 14, lineHeight: 20 }}>
            {children}
          </Text>
        ) : (
          children
        )}
      </View>
    </Pressable>
  );
}

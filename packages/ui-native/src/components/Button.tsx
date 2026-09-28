import { ActivityIndicator, Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

import { color, minTouch, radius, space } from "../tokens";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

type Variant =
  /** The main action on a light ground: dark chrome fill. */
  | "primary"
  /** The main action on the dark chrome: white fill. */
  | "onChrome"
  /** A secondary action on a light ground. */
  | "secondary"
  /** A quiet action on the dark chrome. */
  | "ghostOnChrome"
  /** Destructive (sign out, cancel a shift). */
  | "danger";

const LOOK: Record<Variant, { bg: string; bgPressed: string; fg: keyof typeof color; border?: string }> = {
  primary: { bg: color.chrome, bgPressed: color.chromePressed, fg: "onChrome" },
  onChrome: { bg: color.surface, bgPressed: color.groundDeep, fg: "chrome" },
  secondary: { bg: color.surface, bgPressed: color.groundDeep, fg: "ink", border: color.line },
  ghostOnChrome: { bg: color.buttonOnChrome, bgPressed: color.buttonOnChromePressed, fg: "onChrome" },
  danger: { bg: color.dangerSoft, bgPressed: color.dangerSoftPressed, fg: "danger" },
};

export interface ButtonProps extends Omit<PressableProps, "style" | "children"> {
  label: string;
  variant?: Variant;
  /**
   * 52pt, the size of a primary action; `md` is 44pt, the minimum touch
   * target. A floor, not a fixed height: at a large text size the button
   * grows to fit its label rather than clipping it.
   */
  size?: "lg" | "md";
  icon?: IconName;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  variant = "primary",
  size = "lg",
  icon,
  loading = false,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const look = LOOK[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: loading }}
      disabled={inactive}
      {...rest}
      style={({ pressed }) => [
        {
          minHeight: size === "lg" ? 52 : minTouch,
          paddingHorizontal: space[5],
          paddingVertical: size === "lg" ? space[3] : space[2],
          borderRadius: radius.lg,
          backgroundColor: pressed ? look.bgPressed : look.bg,
          borderWidth: look.border ? 1 : 0,
          borderColor: look.border,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled && !loading ? 0.5 : 1,
          // Press feedback is immediate: a tap that looks ignored gets tapped
          // again, and on clock-in that's a second request.
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color[look.fg]} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          {icon ? <Icon name={icon} size={20} color={look.fg} /> : null}
          <Text variant="button" color={look.fg}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

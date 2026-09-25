import { Pressable, View, type PressableProps } from "react-native";

import { color, minTouch, radius } from "../tokens";
import { CountBadge } from "./CountBadge";
import { Icon, type IconName } from "./Icon";

export interface IconButtonProps extends Omit<PressableProps, "children" | "style"> {
  icon: IconName;
  /** Required: an icon alone says nothing to a screen reader. */
  label: string;
  /**
   * `surface`: white, on the light ground. `chrome`: dark fill, for the main
   * icon action in a header. `onChrome`: translucent, sitting on the dark
   * chrome itself (a button inside the active card).
   */
  tone?: "surface" | "chrome" | "onChrome";
  /** An unread count shown on the corner. 0 or undefined shows nothing. */
  count?: number;
  /** A dot rather than a number, for "something new" without a count. */
  dot?: boolean;
}

export function IconButton({ icon, label, tone = "surface", count, dot, ...rest }: IconButtonProps) {
  const chrome = tone === "chrome";
  const onChrome = tone === "onChrome";
  const size = onChrome ? 52 : minTouch;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? `${label}, ${count} unread` : label}
      hitSlop={4}
      {...rest}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: onChrome ? radius.lg : radius.md,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: onChrome
          ? pressed
            ? "rgba(255,255,255,0.2)"
            : "rgba(255,255,255,0.11)"
          : chrome
            ? color.chrome
            : color.surface,
        borderWidth: chrome || onChrome ? 0 : 1,
        borderColor: color.line,
        transform: [{ scale: pressed ? 0.95 : 1 }],
      })}
    >
      <Icon name={icon} size={21} color={chrome || onChrome ? "onChrome" : "chrome"} />
      {count ? (
        <View style={{ position: "absolute", top: -5, right: -5 }}>
          <CountBadge count={count} />
        </View>
      ) : dot ? (
        <View
          style={{
            position: "absolute",
            top: 8,
            right: 9,
            width: 9,
            height: 9,
            borderRadius: radius.pill,
            backgroundColor: color.badge,
            borderWidth: 2,
            borderColor: chrome ? color.chrome : color.surface,
          }}
        />
      ) : null}
    </Pressable>
  );
}

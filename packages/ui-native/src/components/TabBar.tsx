import { forwardRef, type ReactNode } from "react";
import { Pressable, View, type PressableProps, type ViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { color, elevation, radius, space } from "../tokens";
import { CountBadge } from "./CountBadge";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

/** Height the bar occupies above the safe area, for screens to keep clear. */
export const TAB_BAR_HEIGHT = 76;

/**
 * The floating capsule. Five slots at most; the fifth is "More", which is how
 * five slots serve twenty-odd cleaner routes without a hamburger menu.
 *
 * Built to be driven by expo-router's headless tabs: pass it to
 * `<TabList asChild>` and put `<TabTrigger asChild><TabBarButton/></TabTrigger>`
 * inside. The router supplies the press handler and which tab is focused.
 */
export const TabBarShell = forwardRef<View, ViewProps & { children: ReactNode }>(function TabBarShell(
  { children, style, ...rest },
  ref,
) {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: space[3] + 2,
        paddingBottom: Math.max(insets.bottom, space[3]) + space[1],
      }}
    >
      <View
        ref={ref}
        accessibilityRole="tablist"
        {...rest}
        style={[
          {
            flexDirection: "row",
            gap: 2,
            padding: space[2] - 1,
            borderRadius: radius.pill,
            backgroundColor: color.chrome,
            ...elevation[4],
          },
          style,
        ]}
      >
        {children}
      </View>
    </View>
  );
});

/**
 * How far a tab's label grows with the phone's text size. The bar floats at
 * a fixed size; past 1.3× the labels collide with each other and the icons.
 * Anyone at a larger size still hears the full label from VoiceOver.
 */
const LABEL_MAX_SCALE = 1.3;

export interface TabBarButtonProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  icon: IconName;
  /** Supplied by expo-router's TabTrigger. */
  isFocused?: boolean;
  count?: number;
}

export const TabBarButton = forwardRef<View, TabBarButtonProps>(function TabBarButton(
  { label, icon, isFocused = false, count, ...rest },
  ref,
) {
  return (
    <Pressable
      ref={ref}
      accessibilityRole="tab"
      accessibilityLabel={count ? `${label}, ${count} new` : label}
      accessibilityState={{ selected: isFocused }}
      {...rest}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: "center",
        gap: 3,
        paddingVertical: space[2],
        borderRadius: radius.pill,
        backgroundColor: isFocused ? color.tabOnChrome : pressed ? color.fillOnChrome : "transparent",
      })}
    >
      <View>
        <Icon name={icon} size={21} color={isFocused ? "onChrome" : "onChrome3"} />
        {count ? (
          <View style={{ position: "absolute", top: -6, right: -12 }}>
            <CountBadge count={count} ring={color.chrome} />
          </View>
        ) : null}
      </View>
      <Text
        variant="small"
        weight={isFocused ? "bold" : "semibold"}
        color={isFocused ? "onChrome" : "onChrome3"}
        maxFontSizeMultiplier={LABEL_MAX_SCALE}
        style={{ fontSize: 11, lineHeight: 13 }}
      >
        {label}
      </Text>
    </Pressable>
  );
});

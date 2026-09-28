import { Pressable, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";

import { color, elevation, radius, space } from "../tokens";

export interface CardProps extends ViewProps {
  /**
   * `quiet`: the white card every ordinary item gets.
   * `active`: the solid chrome block for the ONE thing that matters now.
   * Importance is shown by fill, never by a coloured stripe down one side.
   */
  tone?: "quiet" | "active";
  padding?: keyof typeof space;
  /** Makes the whole card a button. */
  onPress?: () => void;
  /** Required with `onPress`: what the card opens. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function Card({ tone = "quiet", padding = 4, onPress, style, children, ...rest }: CardProps) {
  const active = tone === "active";
  const look: ViewStyle = {
    backgroundColor: active ? color.chrome : color.surface,
    borderRadius: active ? radius.xxl : radius.lg,
    borderWidth: active ? 0 : 1,
    borderColor: color.line,
    padding: space[padding],
    ...(active ? elevation[4] : null),
  };

  if (!onPress) {
    return (
      <View {...rest} style={[look, style]}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      {...rest}
      onPress={onPress}
      style={({ pressed }) => [look, { transform: [{ scale: pressed ? 0.985 : 1 }] }, style]}
    >
      {children}
    </Pressable>
  );
}

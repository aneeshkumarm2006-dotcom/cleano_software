import { forwardRef, useState } from "react";
import { Pressable, TextInput, View, type TextInputProps } from "react-native";

import { color, fontFamily, minTouch, radius, space } from "../tokens";
import { Icon } from "./Icon";
import { Text } from "./Text";

export interface TextFieldProps extends Omit<TextInputProps, "style" | "secureTextEntry"> {
  /** Always shown above the field. A placeholder is not a label. */
  label: string;
  /** Shown under the field, in place of the hint, when set. */
  error?: string | null;
  hint?: string;
  /** A password field, with a show/hide control. */
  secret?: boolean;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, secret, editable = true, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const message = error ?? hint;

  return (
    <View style={{ gap: space[2] }}>
      <Text variant="small" weight="semibold" color="ink2">
        {label}
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: 52,
          borderRadius: radius.lg,
          borderWidth: focused || error ? 2 : 1,
          borderColor: error ? color.danger : focused ? color.accent : color.lineStrong,
          backgroundColor: editable ? color.surface : color.groundDeep,
          // Keep the text from shifting when the border thickens on focus.
          paddingLeft: focused || error ? space[4] - 1 : space[4],
        }}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={message ?? undefined}
          editable={editable}
          placeholderTextColor={color.ink3}
          secureTextEntry={secret && !revealed}
          {...rest}
          autoCapitalize={secret ? "none" : rest.autoCapitalize}
          // After the spread, so a caller's own onFocus/onBlur is chained
          // rather than replacing ours and leaving the focus ring stuck.
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={{
            flex: 1,
            minHeight: minTouch,
            paddingVertical: space[3],
            fontFamily: fontFamily.medium,
            fontSize: 16,
            color: color.ink,
          }}
        />
        {secret ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? "Hide password" : "Show password"}
            onPress={() => setRevealed((r) => !r)}
            style={{ width: minTouch + 4, height: minTouch, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name={revealed ? "eyeOff" : "eye"} size={20} color="ink3" />
          </Pressable>
        ) : (
          <View style={{ width: space[4] }} />
        )}
      </View>
      {message ? (
        <Text variant="small" color={error ? "danger" : "ink3"}>
          {message}
        </Text>
      ) : null}
    </View>
  );
});

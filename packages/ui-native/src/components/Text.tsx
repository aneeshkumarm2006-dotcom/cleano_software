import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from "react-native";

import { color as palette, fontFamily, type as scale, type ColorToken, type FontWeightName, type TypeVariant } from "../tokens";

export interface TextProps extends RNTextProps {
  /** A step of the type scale. Defaults to `body`. */
  variant?: TypeVariant;
  /** A colour token. Defaults to `ink`. */
  color?: ColorToken;
  /** Overrides the variant's weight. */
  weight?: FontWeightName;
  /**
   * Tabular figures, for times and money. Digits keep one width, so columns
   * line up and a ticking clock doesn't jiggle.
   */
  numeral?: boolean;
  align?: TextStyle["textAlign"];
}

/**
 * All text in the apps.
 *
 * Custom fonts on Android don't synthesise weights: a `fontWeight` on
 * "Gontserrat" falls back to the regular face. So each weight is its own
 * family name, and this component is the one place that maps a weight to
 * its file.
 */
export function Text({
  variant = "body",
  color = "ink",
  weight,
  numeral,
  align,
  style,
  children,
  ...rest
}: TextProps) {
  const step = scale[variant];
  const uppercase = "uppercase" in step && step.uppercase;
  return (
    <RNText
      {...rest}
      style={[
        {
          fontFamily: fontFamily[weight ?? step.weight],
          fontSize: step.fontSize,
          lineHeight: step.lineHeight,
          letterSpacing: step.letterSpacing,
          color: palette[color],
          textTransform: uppercase ? "uppercase" : undefined,
          fontVariant: numeral ? ["tabular-nums"] : undefined,
          textAlign: align,
        },
        style,
      ]}
    >
      {children}
    </RNText>
  );
}

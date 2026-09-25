import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";

import { color as palette, type ColorToken } from "../tokens";

/**
 * The icons the apps use, by meaning rather than by glyph name, so a screen
 * says "directions" and never "navigate-circle". Solid shapes throughout,
 * per the design rule: icons are filled, never thin outlines.
 */
const GLYPHS = {
  today: "sunny",
  jobs: "calendar-clear",
  available: "flash",
  pay: "wallet",
  more: "ellipsis-horizontal-circle",
  home: "home",
  book: "add-circle",
  bookings: "calendar-clear",
  messages: "chatbubbles",
  account: "person-circle",

  notifications: "notifications",
  chat: "chatbubble-ellipses",
  directions: "navigate",
  clock: "time",
  location: "location",
  phone: "call",
  camera: "camera",
  check: "checkmark-circle",
  close: "close",
  back: "chevron-back",
  forward: "chevron-forward",
  warning: "alert-circle",
  info: "information-circle",
  lock: "lock-closed",
  mail: "mail",
  eye: "eye",
  eyeOff: "eye-off",
  signOut: "log-out",
  kit: "cube",
  training: "school",
  document: "document-text",
  availability: "calendar-number",
  announcements: "megaphone",
  team: "people",
  star: "star",
  gift: "gift",
  help: "help-circle",
  extras: "sparkles",
} as const satisfies Record<string, ComponentProps<typeof Ionicons>["name"]>;

export type IconName = keyof typeof GLYPHS;

export interface IconProps {
  name: IconName;
  size?: number;
  /** A colour token, or a literal for the rare tint outside the palette. */
  color?: ColorToken | (string & {});
}

export function Icon({ name, size = 22, color = "ink" }: IconProps) {
  const tint = color in palette ? palette[color as ColorToken] : color;
  // Decorative by default: the control that holds an icon carries the label.
  return <Ionicons name={GLYPHS[name]} size={size} color={tint} accessibilityElementsHidden importantForAccessibility="no" />;
}

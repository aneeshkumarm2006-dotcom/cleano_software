import { View } from "react-native";

import { color, radius, space, type ColorToken } from "../tokens";
import { Text } from "./Text";

export type PillTone = "accent" | "success" | "warning" | "danger" | "neutral";

const TONE: Record<PillTone, { bg: string; fg: ColorToken }> = {
  accent: { bg: color.accentSoft, fg: "accentText" },
  success: { bg: color.successSoft, fg: "success" },
  warning: { bg: color.warningSoft, fg: "warning" },
  danger: { bg: color.dangerSoft, fg: "danger" },
  neutral: { bg: color.groundDeep, fg: "ink2" },
};

export interface PillProps {
  label: string;
  /** Meaning, not decoration: `success` paid, `warning` time-sensitive, `danger` refused. */
  tone?: PillTone;
}

/**
 * A short status or tag, filled: "PAID", "STARTS IN 3 H", "DEEP CLEAN".
 *
 * The label is the eyebrow step, 11pt, the smallest text a cleaner reads,
 * with the tracking eased so a long label still fits. It grows with the
 * phone's text size only so far (1.3×): a pill is chrome, and past that it
 * crowds the row it labels.
 */
export function Pill({ label, tone = "accent" }: PillProps) {
  const t = TONE[tone];
  return (
    <View style={{ alignSelf: "flex-start", paddingHorizontal: space[2] + 1, paddingVertical: 3, borderRadius: radius.sm - 4, backgroundColor: t.bg }}>
      <Text variant="eyebrow" color={t.fg} numeral maxFontSizeMultiplier={1.3} style={{ letterSpacing: 0.6 }}>
        {label}
      </Text>
    </View>
  );
}

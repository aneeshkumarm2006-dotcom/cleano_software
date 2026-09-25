import { Fragment } from "react";
import { View } from "react-native";

import { color, radius, space, type ColorToken } from "../tokens";
import { Text } from "./Text";

export interface Stat {
  value: string;
  label: string;
  /** Money earned reads in `success`; everything else in `chrome`. */
  tone?: Extract<ColorToken, "chrome" | "success" | "warning" | "danger">;
}

/** A row of large figures with small labels: numbers over icons. */
export function StatStrip({ stats }: { stats: readonly Stat[] }) {
  return (
    <View
      accessible
      accessibilityLabel={stats.map((s) => `${s.label}: ${s.value}`).join(", ")}
      style={{
        flexDirection: "row",
        backgroundColor: color.surface,
        borderWidth: 1,
        borderColor: color.line,
        borderRadius: radius.xl,
        paddingVertical: space[4],
      }}
    >
      {stats.map((s, i) => (
        <Fragment key={s.label}>
          {i > 0 ? <View style={{ width: 1, backgroundColor: color.line }} /> : null}
          <View style={{ flex: 1, alignItems: "center", gap: space[1] }}>
            <Text variant="heading" numeral color={s.tone ?? "chrome"} style={{ fontSize: 22, lineHeight: 24 }}>
              {s.value}
            </Text>
            <Text variant="eyebrow" color="ink3" style={{ fontSize: 10 }}>
              {s.label}
            </Text>
          </View>
        </Fragment>
      ))}
    </View>
  );
}

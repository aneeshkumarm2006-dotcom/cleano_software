import { space, Text } from "@bookmops/ui-native";
import type { ReactNode } from "react";
import { View } from "react-native";

/** The top of a tab screen: an optional eyebrow, the title, and actions. */
export function ScreenHeader({ eyebrow, title, actions }: { eyebrow?: string; title: string; actions?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[5], paddingBottom: space[4] }}>
      <View style={{ flex: 1, gap: space[1] }}>
        {eyebrow ? (
          <Text variant="eyebrow" color="accentText">
            {eyebrow}
          </Text>
        ) : null}
        <Text variant="title" accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
      </View>
      {actions ? <View style={{ flexDirection: "row", gap: space[2] }}>{actions}</View> : null}
    </View>
  );
}

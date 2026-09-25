import { color, space, Text } from "@bookmops/ui-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BackButton } from "@/components/BackButton";

/** The top of a conversation: back, who it's with, and a line about them. */
export function ThreadHeader({
  badge,
  title,
  subtitle,
  online,
}: {
  /** The avatar or icon block for who the conversation is with. */
  badge: ReactNode;
  title: string;
  subtitle?: string | null;
  /** A green dot before the subtitle, when someone is there now. */
  online?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: insets.top + space[2],
        paddingBottom: space[3],
        paddingHorizontal: space[4],
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        backgroundColor: color.surface,
        borderBottomWidth: 1,
        borderBottomColor: color.line,
      }}
    >
      <BackButton fallback="/" />
      {badge}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="subheading" accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] + 1 }}>
            {online ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color.success }} /> : null}
            <Text variant="small" color="ink2" numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

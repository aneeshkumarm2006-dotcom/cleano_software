import { View } from "react-native";

import { color, radius } from "../tokens";
import { Text } from "./Text";

/** An unread count. Past 99 it reads "99+" so it never outgrows its corner. */
export function CountBadge({ count, ring = color.ground }: { count: number; ring?: string }) {
  if (count <= 0) return null;
  return (
    <View
      style={{
        minWidth: 20,
        height: 20,
        paddingHorizontal: 5,
        borderRadius: radius.pill,
        backgroundColor: color.badge,
        borderWidth: 2,
        borderColor: ring,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text variant="eyebrow" color="onChrome" numeral style={{ fontSize: 10, lineHeight: 12, letterSpacing: 0 }}>
        {count > 99 ? "99+" : String(count)}
      </Text>
    </View>
  );
}

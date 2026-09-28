import { View } from "react-native";

import { color, radius } from "../tokens";
import { Text } from "./Text";

/**
 * An unread count. Past 99 it reads "99+" so it never outgrows its corner,
 * and it grows with the phone's text size only so far (1.3×), taller rather
 * than clipped when it does.
 */
export function CountBadge({ count, ring = color.ground }: { count: number; ring?: string }) {
  if (count <= 0) return null;
  return (
    <View
      style={{
        minWidth: 20,
        minHeight: 20,
        paddingHorizontal: 5,
        borderRadius: radius.pill,
        backgroundColor: color.badge,
        borderWidth: 2,
        borderColor: ring,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text variant="eyebrow" color="onChrome" numeral maxFontSizeMultiplier={1.3} style={{ lineHeight: 13, letterSpacing: 0 }}>
        {count > 99 ? "99+" : String(count)}
      </Text>
    </View>
  );
}

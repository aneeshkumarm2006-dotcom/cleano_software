import { color, space, Text } from "@bookmops/ui-native";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * The customer app's first screen, until its own screens are built
 * (docs/design/mobile, the Cust* designs). It exists so the app builds and
 * runs from the first commit, on the same design system as Bookmops Pro.
 */
export default function Welcome() {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: color.chrome,
        paddingTop: insets.top + space[12],
        paddingHorizontal: space[6],
        gap: space[3],
      }}
    >
      <Text variant="eyebrow" color="accentOnChrome" style={{ fontSize: 15, letterSpacing: 2 }}>
        Bookmops
      </Text>
      <Text variant="title" color="onChrome" accessibilityRole="header">
        Book a clean, follow it, pay for it.
      </Text>
      <Text variant="body" color="onChrome2">
        The customer app is being built. Its screens arrive after Bookmops Pro.
      </Text>
    </View>
  );
}

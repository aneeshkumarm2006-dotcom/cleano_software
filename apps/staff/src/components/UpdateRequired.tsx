import { Button, color, Icon, radius, space, Text } from "@bookmops/ui-native";
import { Linking, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Store pages. The App Store id is filled in once the listing exists. */
const STORE_URL = Platform.select({
  ios: "https://apps.apple.com/app/bookmops-pro/id0000000000",
  default: "https://play.google.com/store/apps/details?id=com.bookmops.pro",
});

/**
 * Shown, and nothing else, when the server says this build is too old (426).
 * Queued clock times are kept and sent once the app is updated.
 */
export function UpdateRequired() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: color.chrome, paddingTop: insets.top + space[12], paddingHorizontal: space[6], paddingBottom: insets.bottom + space[6], gap: space[5] }}>
      <View style={{ width: 64, height: 64, borderRadius: radius.xl, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" }}>
        <Icon name="info" size={32} color="accentOnChrome" />
      </View>
      <Text variant="title" color="onChrome" accessibilityRole="header">
        Please update Bookmops Pro
      </Text>
      <Text variant="body" color="onChrome2">
        This version is too old to connect. Updating takes a minute, and anything you clocked is saved on your phone
        and will be sent once you're updated.
      </Text>
      <View style={{ marginTop: "auto" }}>
        <Button label="Update now" variant="onChrome" onPress={() => void Linking.openURL(STORE_URL)} />
      </View>
    </View>
  );
}

import { ApiError } from "@bookmops/api/client";
import { Button, color, Icon, radius, space, Text, type IconName } from "@bookmops/ui-native";
import { ActivityIndicator, View } from "react-native";

/** Loading: a quiet spinner where the content will be. */
export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <View accessibilityLabel={label} accessibilityRole="progressbar" style={{ paddingVertical: space[12], alignItems: "center" }}>
      <ActivityIndicator color={color.accent} />
    </View>
  );
}

/** An error, in words for the person holding the phone, and a way forward. */
export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message =
    error instanceof ApiError ? error.message : "Something went wrong. Check your connection and try again.";
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ padding: space[5], gap: space[4], borderRadius: radius.lg, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line }}
    >
      <View style={{ flexDirection: "row", gap: space[3], alignItems: "flex-start" }}>
        <Icon name="warning" size={22} color="danger" />
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {message}
        </Text>
      </View>
      <Button label="Try again" variant="secondary" size="md" onPress={onRetry} />
    </View>
  );
}

/** Nothing to show — said plainly, with what to do about it if anything. */
export function Empty({ icon, title, detail }: { icon: IconName; title: string; detail?: string }) {
  return (
    <View style={{ paddingVertical: space[10], paddingHorizontal: space[6], alignItems: "center", gap: space[3] }}>
      <View style={{ width: 56, height: 56, borderRadius: radius.xl, backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={26} color="accentText" />
      </View>
      <Text variant="subheading" align="center">
        {title}
      </Text>
      {detail ? (
        <Text variant="body" color="ink2" align="center">
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

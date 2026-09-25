import { Button, Card, color, Icon, radius, space, Text } from "@bookmops/ui-native";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { secureStorage } from "@/auth/secure-storage";
import { useSource } from "@/data/session";
import { enablePush, PRIMER_DISMISSED_KEY, pushPermission } from "@/notifications/push";

/**
 * Why to turn on notifications, before the system asks. Shown on Today until
 * the person decides; "Not now" hides it without spending the system prompt.
 */
export function NotificationsPrimer() {
  const source = useSource();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void pushPermission().then((p) => {
      if (!alive) return;
      if (p === "granted") {
        // Already allowed: refresh the registration quietly (tokens rotate).
        void enablePush(source).catch(() => undefined);
      } else if (p === "undetermined" && !secureStorage.getItem(PRIMER_DISMISSED_KEY)) {
        setVisible(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [source]);

  if (!visible) return null;

  return (
    <Card padding={4}>
      <View style={{ flexDirection: "row", gap: space[3] }}>
        <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }}>
          <Icon name="notifications" size={22} color="accentText" />
        </View>
        <View style={{ flex: 1, gap: space[1] }}>
          <Text variant="bodyStrong">Hear about new jobs first</Text>
          <Text variant="small" color="ink2">
            Get a notification when a job is offered to you, when the office messages you, and before each job starts.
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], marginTop: space[4] }}>
        <Button
          label="Turn on"
          size="md"
          loading={busy}
          style={{ flex: 1 }}
          onPress={async () => {
            setBusy(true);
            await enablePush(source).catch(() => undefined);
            setBusy(false);
            setVisible(false);
          }}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            secureStorage.setItem(PRIMER_DISMISSED_KEY, "1");
            setVisible(false);
          }}
          style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: space[3] }}
        >
          <Text variant="bodyStrong" color="ink2">
            Not now
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}

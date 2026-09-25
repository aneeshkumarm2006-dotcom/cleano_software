import { Button, Card, color, radius, Screen, space, TAB_BAR_HEIGHT, Text } from "@bookmops/ui-native";
import { View } from "react-native";

import { MenuGroup } from "@/components/MenuList";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useMe, useToday } from "@/data/queries";
import { useSession } from "@/data/session";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export default function More() {
  const me = useMe();
  const today = useToday();
  const { signOut } = useSession();
  const person = me.data?.person;

  return (
    <Screen header={<ScreenHeader title="More" />} bottomInset={TAB_BAR_HEIGHT}>
      {person ? (
        <Card padding={4}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
            <View style={{ width: 48, height: 48, borderRadius: radius.pill, backgroundColor: color.chrome, alignItems: "center", justifyContent: "center" }}>
              <Text variant="bodyStrong" color="onChrome">
                {initials(person.name)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="subheading">{person.name}</Text>
              <Text variant="small" color="ink2">
                {me.data?.company.name}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      <MenuGroup
        title="My work"
        items={[
          { key: "kit", label: "My kit", icon: "kit", soon: true },
          { key: "availability", label: "Availability", icon: "availability", soon: true },
          { key: "calendar", label: "Calendar", icon: "jobs", soon: true },
        ]}
      />
      <MenuGroup
        title="Messages"
        items={[
          { key: "office", label: "Office chat", icon: "chat", soon: true, count: today.data?.unread.office },
          { key: "team", label: "Team chat", icon: "team", soon: true },
          { key: "announcements", label: "Announcements", icon: "announcements", soon: true },
        ]}
      />
      <MenuGroup
        title="My record"
        items={[
          { key: "training", label: "Training", icon: "training", soon: true },
          { key: "documents", label: "Documents", icon: "document", soon: true },
        ]}
      />

      <Button label="Sign out" variant="danger" icon="signOut" onPress={signOut} />
    </Screen>
  );
}

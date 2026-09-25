import { Button, Card, color, radius, Screen, space, TAB_BAR_HEIGHT, Text } from "@bookmops/ui-native";
import { router } from "expo-router";
import { View } from "react-native";

import { MenuGroup } from "@/components/MenuList";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useDocuments, useKit, useMe, useToday, useTraining } from "@/data/queries";
import { useSession } from "@/data/session";
import { kitCounts } from "@/features/kit/display";

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
  const kit = useKit();
  const training = useTraining();
  const documents = useDocuments();
  const { low, tools } = kitCounts(kit.data);
  const toSign = documents.data?.items.filter((d) => d.status === "PENDING").length ?? 0;
  const trainingDone = training.data ? training.data.completed >= training.data.total : false;

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
          {
            key: "kit",
            label: "My kit",
            icon: "kit",
            onPress: () => router.push("/kit"),
            status: low > 0 ? `${low} low` : tools > 0 ? `${tools} to fix` : undefined,
          },
          { key: "availability", label: "Availability", icon: "availability", onPress: () => router.push("/availability") },
          { key: "calendar", label: "Calendar", icon: "jobs", onPress: () => router.push("/calendar") },
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
          {
            key: "training",
            label: "Training",
            icon: "training",
            onPress: () => router.push("/training"),
            status: training.data && training.data.total > 0 ? `${training.data.completed}/${training.data.total}` : undefined,
            statusTone: trainingDone ? "success" : "warning",
          },
          {
            key: "documents",
            label: "Documents",
            icon: "document",
            onPress: () => router.push("/documents"),
            status: toSign > 0 ? `${toSign} to sign` : undefined,
          },
          { key: "strikes", label: "My standing", icon: "standing", onPress: () => router.push("/strikes") },
        ]}
      />

      <Button label="Sign out" variant="danger" icon="signOut" onPress={signOut} />
    </Screen>
  );
}

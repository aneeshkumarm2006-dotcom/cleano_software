import { Card, color, radius, space, Text } from "@bookmops/ui-native";
import { View } from "react-native";

import { useMe } from "@/data/queries";
import { initials } from "@/lib/format";

/** Who is signed in, and to which company: the top of More. */
export function ProfileCard({ detail }: { detail?: string }) {
  const me = useMe();
  const person = me.data?.person;
  if (!person) return null;
  return (
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
            {[detail, me.data?.company.name].filter(Boolean).join(" · ")}
          </Text>
        </View>
      </View>
    </Card>
  );
}

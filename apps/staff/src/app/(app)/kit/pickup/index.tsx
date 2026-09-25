import { Card, Icon, space, Text } from "@bookmops/ui-native";
import { router } from "expo-router";
import { View } from "react-native";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useKitLocations } from "@/data/queries";
import { BackHeader, Page } from "@/features/record/ui";

/** Picking up from storage, step one: where are you? */
export default function PickupLocations() {
  const locations = useKitLocations();
  const items = locations.data?.items ?? [];
  return (
    <Page header={<BackHeader title="Pick up from storage" />} refreshing={locations.isRefetching} onRefresh={() => locations.refetch()}>
      {locations.isPending ? (
        <Loading />
      ) : locations.isError ? (
        <LoadError error={locations.error} onRetry={() => locations.refetch()} />
      ) : items.length === 0 ? (
        <Empty icon="location" title="No storage set up" detail="The office hasn't added a warehouse or locker yet. Ask them where to collect supplies." />
      ) : (
        <>
          <Text variant="body" color="ink2">
            Where are you picking up from? What you take is added to your kit.
          </Text>
          {items.map((loc) => (
            <Card
              key={loc.id}
              padding={4}
              onPress={() => router.push({ pathname: "/kit/pickup/[locationId]", params: { locationId: loc.id } })}
              accessibilityLabel={`${loc.name}${loc.address ? `, ${loc.address}` : ""}`}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
                <Icon name="location" size={22} color="accentText" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong">{loc.name}</Text>
                  {loc.address ? (
                    <Text variant="small" color="ink2">
                      {loc.address}
                    </Text>
                  ) : null}
                </View>
                <Icon name="forward" size={18} color="ink3" />
              </View>
            </Card>
          ))}
        </>
      )}
    </Page>
  );
}

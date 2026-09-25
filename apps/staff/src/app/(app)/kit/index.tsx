import { Button, color, radius, space, Text } from "@bookmops/ui-native";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { View } from "react-native";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useKit, useMe } from "@/data/queries";
import { kitCounts } from "@/features/kit/display";
import { KitRow } from "@/features/kit/KitRow";
import { BackHeader, Page, SectionTitle, Tag } from "@/features/record/ui";

/**
 * My kit: what the cleaner carries and how each thing stands. Items that need
 * attention come first and are filled; everything opens to recount, report a
 * problem or ask for more.
 */
export default function Kit() {
  const me = useMe();
  const kit = useKit();
  const tz = me.data?.company.timezone;
  const { low, tools } = kitCounts(kit.data);
  const items = kit.data?.items ?? [];
  const attention = items.filter((i) => i.attention.needsAttention);
  const fine = items.filter((i) => !i.attention.needsAttention);

  return (
    <Page
      header={<BackHeader title="My kit" right={low > 0 ? <Tag label={`${low} running low`} tone="warn" /> : null} />}
      refreshing={kit.isRefetching}
      onRefresh={() => kit.refetch()}
      footer={
        items.length > 0 ? (
          <Button label="Request a restock" icon="restock" onPress={() => router.push("/kit/restock")} />
        ) : undefined
      }
    >
      {kit.isPending || !tz ? (
        <Loading label="Loading your kit" />
      ) : kit.isError ? (
        <LoadError error={kit.error} onRetry={() => kit.refetch()} />
      ) : items.length === 0 ? (
        <>
          <Empty
            icon="kit"
            title="Nothing in your kit yet"
            detail="Pick up your supplies from storage, or add what you already have."
          />
          <Button label="Pick up from storage" icon="pickup" onPress={() => router.push("/kit/pickup")} />
          <Button label="Add what I already have" variant="secondary" icon="add" onPress={() => router.push("/kit/add")} />
        </>
      ) : (
        <>
          <Text variant="body" color="ink2">
            {low === 0 && tools === 0
              ? "Everything is stocked and working."
              : [
                  low > 0 ? `${low} ${low === 1 ? "item is" : "items are"} running low` : null,
                  tools > 0 ? `${tools} ${tools === 1 ? "tool needs" : "tools need"} fixing or replacing` : null,
                ]
                  .filter(Boolean)
                  .join(", and ") + "."}
          </Text>

          {attention.length > 0 ? (
            <>
              <SectionTitle>Needs attention</SectionTitle>
              <List>
                {attention.map((item, i) => (
                  <KitRow key={item.productId} item={item} timeZone={tz} first={i === 0} />
                ))}
              </List>
            </>
          ) : null}

          {fine.length > 0 ? (
            <>
              <SectionTitle>{attention.length > 0 ? "All good" : "In your kit"}</SectionTitle>
              <List>
                {fine.map((item, i) => (
                  <KitRow key={item.productId} item={item} timeZone={tz} first={i === 0} />
                ))}
              </List>
            </>
          ) : null}

          <View style={{ gap: space[2] }}>
            <Button label="Pick up from storage" variant="secondary" icon="pickup" onPress={() => router.push("/kit/pickup")} />
            <Button label="Add what I already have" variant="secondary" icon="add" onPress={() => router.push("/kit/add")} />
          </View>
        </>
      )}
    </Page>
  );
}

function List({ children }: { children: ReactNode }) {
  return (
    <View style={{ backgroundColor: color.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: color.line, overflow: "hidden" }}>
      {children}
    </View>
  );
}

import type { KitItem } from "@bookmops/api/v1";
import { Card, color, Pill, radius, space, Text } from "@bookmops/ui-native";
import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { MenuGroup, type MenuItem } from "@/components/MenuList";
import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useKitItem, useMe } from "@/data/queries";
import { amount, canRestock, fill, isTool, toneOf } from "@/features/kit/display";
import { BackHeader, Notice, Page, pillTone, quantityText } from "@/features/record/ui";
import { dayMonth } from "@/lib/dates";

/** One kit item: where it stands, and what the cleaner can do about it. */
export default function KitItemScreen() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const me = useMe();
  const kit = useKitItem(productId);
  const tz = me.data?.company.timezone;
  const item = kit.item;

  return (
    <Page header={<BackHeader title={item?.name ?? "Kit item"} />} refreshing={kit.isRefetching} onRefresh={() => kit.refetch()}>
      {kit.isPending || !tz ? (
        <Loading label="Loading the item" />
      ) : kit.isError ? (
        <LoadError error={kit.error} onRetry={() => kit.refetch()} />
      ) : !item ? (
        <Empty icon="kit" title="Not in your kit" detail="This item isn't in your kit any more." />
      ) : (
        <Detail item={item} timeZone={tz} />
      )}
    </Page>
  );
}

const BAR = { ok: color.success, warn: color.warning, critical: color.danger, neutral: color.ink3, accent: color.accent } as const;

function Detail({ item, timeZone }: { item: KitItem; timeZone: string }) {
  const tone = toneOf(item);
  const f = fill(item);
  const tool = isTool(item);
  const reportedLevel = item.attention.kind === "LEVEL";
  const go = (screen: "count" | "condition" | "issue") =>
    router.push({ pathname: `/kit/[productId]/${screen}`, params: { productId: item.productId } });

  const actions: MenuItem[] = [
    ...(tool ? [{ key: "condition", label: "Update its condition", icon: "tool" as const, onPress: () => go("condition") }] : []),
    ...(canRestock(item) && !item.pendingRequest
      ? [
          {
            key: "restock",
            label: "Ask for more",
            icon: "restock" as const,
            onPress: () => router.push({ pathname: "/kit/restock", params: { productId: item.productId } }),
          },
        ]
      : []),
    { key: "count", label: "Recount", icon: "kit", onPress: () => go("count") },
    ...(item.quantity > 0 ? [{ key: "issue", label: "Report a problem", icon: "flag" as const, onPress: () => go("issue") }] : []),
  ];

  return (
    <>
      <Card padding={5}>
        <View style={{ gap: space[3] }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[3] }}>
            <View style={{ flex: 1, gap: space[1] }}>
              <Text variant="eyebrow" color="ink3">
                {tool ? "Condition" : reportedLevel ? "Reported level" : "In your kit"}
              </Text>
              <Text variant="display" color="chrome" numeral>
                {tool || reportedLevel ? item.attention.label : quantityText(item.quantity)}
              </Text>
              <Text variant="small" color="ink2" numeral>
                {tool || reportedLevel ? amount(item) : item.unit}
              </Text>
            </View>
            <Pill label={item.attention.label} tone={pillTone(tone)} />
          </View>
          {f != null ? (
            <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: color.groundDeep, overflow: "hidden" }}>
              <View style={{ width: `${Math.round(f * 100)}%`, height: "100%", borderRadius: radius.pill, backgroundColor: BAR[tone] }} />
            </View>
          ) : null}
          <Text variant="small" color="ink2">
            {tool
              ? item.statusUpdatedAt
                ? `Last checked ${dayMonth(item.statusUpdatedAt, timeZone)}. A tool never runs low: tell the office if it breaks or goes missing.`
                : "Nobody has reported on this tool yet. A tool never runs low: tell the office if it breaks or goes missing."
              : reportedLevel && item.statusUpdatedAt
                ? `You reported this ${item.attention.label.toLowerCase()} on ${dayMonth(item.statusUpdatedAt, timeZone)}.`
                : item.refillAt != null
                  ? `Ask for more at ${quantityText(item.refillAt)} ${item.unit} or fewer.`
                  : `Updated ${dayMonth(item.updatedAt, timeZone)}.`}
          </Text>
        </View>
      </Card>

      {item.statusNote ? (
        <Notice tone="neutral" icon="chat" title="Your note">
          {item.statusNote}
        </Notice>
      ) : null}

      {item.pendingRequest ? (
        <Notice tone="accent" icon="restock" title="Restock requested">
          {`You asked for ${quantityText(item.pendingRequest.quantity)} ${item.unit} on ${dayMonth(item.pendingRequest.requestedAt, timeZone)}. The office will top you up.`}
        </Notice>
      ) : null}

      {item.description ? (
        <Text variant="body" color="ink2">
          {item.description}
        </Text>
      ) : null}

      <MenuGroup title="What do you need to do?" items={actions} />
    </>
  );
}

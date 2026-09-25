import type { KitItem } from "@bookmops/api/v1";
import { color, Icon, minTouch, radius, space, Text } from "@bookmops/ui-native";
import { router } from "expo-router";
import { Pressable, View } from "react-native";

import { Tag } from "@/features/record/ui";
import { dayMonth } from "@/lib/dates";

import { fill, subline, toneOf } from "./display";

const ROW_FILL = { warn: color.warningSoft, critical: color.dangerSoft } as const;
const BAR = { ok: color.success, warn: color.warning, critical: color.danger, neutral: color.ink3, accent: color.accent } as const;

/**
 * One kit item. An item that needs attention is FILLED (amber when low, red
 * when empty or broken) so it stands out in the list without a stripe.
 */
export function KitRow({ item, timeZone, first }: { item: KitItem; timeZone: string; first: boolean }) {
  const tone = toneOf(item);
  const f = fill(item);
  const background = item.attention.needsAttention && (tone === "warn" || tone === "critical") ? ROW_FILL[tone] : color.surface;
  const pending = item.pendingRequest;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${item.attention.label}. ${subline(item, timeZone)}${pending ? ". Restock requested" : ""}`}
      accessibilityHint="Opens the item"
      onPress={() => router.push({ pathname: "/kit/[productId]", params: { productId: item.productId } })}
      style={({ pressed }) => ({
        minHeight: minTouch + 20,
        paddingHorizontal: space[4],
        paddingVertical: space[3] + 2,
        gap: space[2],
        backgroundColor: pressed ? color.groundDeep : background,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: color.line,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {item.name}
          </Text>
          <Text variant="small" color="ink2" numeral numberOfLines={2}>
            {subline(item, timeZone)}
          </Text>
          {pending ? (
            <Text variant="small" weight="semibold" color="accentText">
              Restock requested {dayMonth(pending.requestedAt, timeZone)}
            </Text>
          ) : null}
        </View>
        <Tag label={item.attention.label} tone={tone} />
        <Icon name="forward" size={16} color="ink3" />
      </View>
      {f != null ? (
        <View style={{ height: 7, borderRadius: radius.pill, backgroundColor: color.groundDeep, overflow: "hidden" }}>
          <View style={{ width: `${Math.round(f * 100)}%`, height: "100%", borderRadius: radius.pill, backgroundColor: BAR[tone] }} />
        </View>
      ) : null}
    </Pressable>
  );
}

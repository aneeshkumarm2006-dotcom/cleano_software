import type { KitReportEntry, KitReportItem } from "@bookmops/api/v1";
import { Button, Card, ChoiceChips, color, IconButton, space, Stepper, Text } from "@bookmops/ui-native";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useClockActions } from "@/data/outbox/actions";
import { useKitReport } from "@/data/queries";

const LEVELS = [
  { value: "FULL", label: "Full" },
  { value: "GOOD", label: "Good" },
  { value: "HALF", label: "Half" },
  { value: "LOW", label: "Low", tone: "warn" },
  { value: "EMPTY", label: "Empty", tone: "bad" },
] as const;

const COUNT_STATUSES = [
  { value: "OK", label: "OK" },
  { value: "LOW", label: "Low", tone: "warn" },
  { value: "EMPTY", label: "Empty", tone: "bad" },
  { value: "MISSING", label: "Missing", tone: "bad" },
  { value: "DAMAGED", label: "Damaged", tone: "bad" },
] as const;

const CONDITIONS = [
  { value: "AVAILABLE", label: "Good" },
  { value: "NEEDS_MAINTENANCE", label: "Needs maintenance", tone: "warn" },
  { value: "NEEDS_REPLACEMENT", label: "Needs replacing", tone: "warn" },
  { value: "DAMAGED", label: "Damaged", tone: "bad" },
  { value: "MISSING", label: "Missing", tone: "bad" },
] as const;

type Draft = Partial<Omit<KitReportEntry, "productId" | "kind">>;

/**
 * Before clocking out: what state the kit is in. The same report the web asks
 * for, so the office's stock and restock alerts stay right. Every item needs
 * an answer; counts start from what the office has on record.
 */
export default function ClockOut() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const kit = useKitReport(id);
  const { clockOut } = useClockActions(id);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const items = kit.data?.items ?? [];
  const entries = useMemo(() => items.map((item) => toEntry(item, drafts[item.productId])), [items, drafts]);
  const missing = entries.filter((e) => e === null).length;
  const report = entries.filter((e): e is KitReportEntry => e !== null && e !== SKIP);

  function set(productId: string, patch: Draft) {
    setDrafts((d) => ({ ...d, [productId]: { ...d[productId], ...patch } }));
  }

  function submit() {
    if (missing > 0) return;
    clockOut(report);
    router.back();
  }

  return (
    <View style={{ flex: 1, backgroundColor: color.ground }}>
      <View style={{ paddingTop: insets.top + space[2], paddingHorizontal: space[4], flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <IconButton icon="back" label="Back to the clock" onPress={() => router.back()} />
      </View>

      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: 130 + insets.bottom }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: space[1] }}>
          <Text variant="title" accessibilityRole="header">
            Before you clock out
          </Text>
          <Text variant="body" color="ink2">
            How is your kit? This tells the office what to restock.
          </Text>
        </View>

        {kit.isPending ? (
          <Loading label="Loading your kit" />
        ) : kit.isError ? (
          <LoadError error={kit.error} onRetry={() => kit.refetch()} />
        ) : items.length === 0 ? (
          <Empty icon="kit" title="Nothing to report" detail="You have no kit items on record for this job." />
        ) : (
          items.map((item) => (
            <Card key={item.productId} padding={4}>
              <View style={{ gap: space[3] }}>
                <Text variant="subheading">{item.name}</Text>
                {item.kind === "LEVEL" ? (
                  <ChoiceChips
                    label={`Level of ${item.name}`}
                    options={LEVELS}
                    value={drafts[item.productId]?.levelStatus ?? null}
                    onChange={(v) => set(item.productId, { levelStatus: v })}
                  />
                ) : item.kind === "COUNT" ? (
                  <>
                    <Stepper
                      label={item.name}
                      unit={item.unit}
                      value={drafts[item.productId]?.quantity ?? item.quantity}
                      onChange={(v) => set(item.productId, { quantity: v })}
                    />
                    <ChoiceChips
                      label={`State of ${item.name}`}
                      options={COUNT_STATUSES}
                      value={drafts[item.productId]?.status ?? null}
                      onChange={(v) => set(item.productId, { status: v })}
                    />
                  </>
                ) : item.kind === "CONDITION" ? (
                  <ChoiceChips
                    label={`Condition of ${item.name}`}
                    options={CONDITIONS}
                    value={drafts[item.productId]?.condition ?? null}
                    onChange={(v) => set(item.productId, { condition: v })}
                  />
                ) : (
                  <Text variant="small" color="ink3">
                    This item can't be reported from this version of the app. Update the app, or report it on the web.
                  </Text>
                )}
              </View>
            </Card>
          ))
        )}
      </ScrollView>

      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: space[4],
          paddingTop: space[3],
          paddingBottom: insets.bottom + space[3],
          backgroundColor: color.surface,
          borderTopWidth: 1,
          borderTopColor: color.line,
          gap: space[2],
        }}
      >
        {missing > 0 && items.length > 0 ? (
          <Text variant="small" color="ink2" align="center">
            {missing} item{missing === 1 ? "" : "s"} left to report
          </Text>
        ) : null}
        <Button label="Clock out" disabled={kit.isPending || missing > 0} onPress={submit} />
      </View>
    </View>
  );
}

/** An item this build can't report on: sent as nothing, never as a guess. */
const SKIP = "skip" as const;

/**
 * The report entry for an item: null while it still needs an answer, SKIP for
 * a kind this build doesn't know.
 */
function toEntry(item: KitReportItem, d: Draft | undefined): KitReportEntry | null | typeof SKIP {
  switch (item.kind) {
    case "LEVEL":
      return d?.levelStatus ? { productId: item.productId, kind: "LEVEL", levelStatus: d.levelStatus } : null;
    case "COUNT":
      return d?.status
        ? { productId: item.productId, kind: "COUNT", quantity: d.quantity ?? item.quantity, status: d.status }
        : null;
    case "CONDITION":
      return d?.condition ? { productId: item.productId, kind: "CONDITION", condition: d.condition } : null;
    default:
      // Left out, never guessed: inventing "OK" would put a false count in the
      // office's stock. The server flags a missing line for the office rather
      // than refusing the clock-out (API_V1.md §6).
      return SKIP;
  }
}

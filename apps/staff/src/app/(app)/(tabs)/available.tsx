import type { AvailableJobSummary, AvailableWhen } from "@bookmops/api/v1";
import { Button, Screen, Segmented, space, TAB_BAR_HEIGHT, Text } from "@bookmops/ui-native";
import { useState } from "react";
import { View } from "react-native";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useAvailableJobs, useMe } from "@/data/queries";
import { AvailableRailLine, AvailableRow } from "@/features/available/AvailableRow";
import { useClaimFlow } from "@/features/available/useClaimFlow";
import { dayLabel } from "@/features/available/words";
import { RAIL_WIDTH } from "@/features/jobs/TimelineRow";
import { localDateKey } from "@/lib/format";
import { useNow } from "@/lib/use-now";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "week", label: "Next 7 days" },
  { value: "weekend", label: "Weekend" },
] as const satisfies readonly { value: AvailableWhen; label: string }[];

export default function AvailableTab() {
  const [when, setWhen] = useState<AvailableWhen>("all");
  const me = useMe();
  const board = useAvailableJobs(when);
  const tz = me.data?.company.timezone;
  const currency = me.data?.company.currency ?? "CAD";
  const items = board.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Screen
      header={<ScreenHeader title="Available jobs" />}
      bottomInset={TAB_BAR_HEIGHT}
      refreshing={board.isRefetching && !board.isFetchingNextPage}
      onRefresh={() => board.refetch()}
    >
      <Text variant="body" color="ink2" style={{ marginTop: -space[2] }}>
        Open jobs you can take. First to claim keeps it.
      </Text>
      <Segmented label="Which jobs" options={FILTERS} value={when} onChange={setWhen} />

      {board.isPending || me.isPending ? (
        <Loading label="Loading open jobs" />
      ) : me.isError || !tz ? (
        <LoadError error={me.error} onRetry={() => me.refetch()} />
      ) : board.isError ? (
        <LoadError error={board.error} onRetry={() => board.refetch()} />
      ) : items.length === 0 ? (
        <Empty
          icon="available"
          title={when === "all" ? "No open jobs right now" : "No open jobs for these days"}
          detail="New jobs appear here as the office posts them. Pull down to check again."
        />
      ) : (
        <Board
          items={items}
          timeZone={tz}
          currency={currency}
          hasMore={board.hasNextPage}
          loadingMore={board.isFetchingNextPage}
          onMore={() => board.fetchNextPage()}
        />
      )}
    </Screen>
  );
}

function Board({
  items,
  timeZone,
  currency,
  hasMore,
  loadingMore,
  onMore,
}: {
  items: readonly AvailableJobSummary[];
  timeZone: string;
  currency: string;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
}) {
  const now = useNow();
  const { ask, claimingId } = useClaimFlow({ timeZone, currency, from: "list" });
  const firstId = items[0]?.id;

  return (
    <>
      <Text variant="small" weight="semibold" color="ink3" numeral accessibilityLiveRegion="polite">
        {items.length}
        {hasMore ? "+" : ""} open job{items.length === 1 ? "" : "s"}
      </Text>
      {groupByDay(items, timeZone).map(([day, group]) => (
        <View key={day} style={{ gap: space[3] }}>
          <Text variant="eyebrow" color="chrome" accessibilityRole="header" style={{ paddingLeft: RAIL_WIDTH + space[5] }}>
            {dayLabel(group[0].startsAt, timeZone, now)}
          </Text>
          <View style={{ gap: space[3] }}>
            <AvailableRailLine />
            {group.map((job) => (
              <AvailableRow
                key={job.id}
                job={job}
                timeZone={timeZone}
                currency={currency}
                now={now}
                emphasis={job.id === firstId}
                claiming={claimingId === job.id}
                onClaim={() => ask(job)}
              />
            ))}
          </View>
        </View>
      ))}
      {hasMore ? <Button label="Show more jobs" variant="secondary" size="md" loading={loadingMore} onPress={onMore} /> : null}
    </>
  );
}

/** Jobs grouped under the calendar day they start on, in the company's zone. */
function groupByDay(items: readonly AvailableJobSummary[], tz: string): [string, AvailableJobSummary[]][] {
  const groups = new Map<string, AvailableJobSummary[]>();
  for (const job of items) {
    const key = localDateKey(job.startsAt, tz);
    const list = groups.get(key);
    if (list) list.push(job);
    else groups.set(key, [job]);
  }
  return [...groups];
}

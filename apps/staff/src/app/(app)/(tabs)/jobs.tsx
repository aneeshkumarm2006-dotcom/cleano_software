import type { JobScope } from "@bookmops/api/v1";
import { Screen, Segmented, space, TAB_BAR_HEIGHT, Text } from "@bookmops/ui-native";
import { useState } from "react";
import { View } from "react-native";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useJobs, useMe } from "@/data/queries";
import { RailLine, RAIL_WIDTH, TimelineRow } from "@/features/jobs/TimelineRow";
import { groupByDay, shortDate } from "@/lib/format";

const SCOPES = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
] as const satisfies readonly { value: JobScope; label: string }[];

export default function Jobs() {
  const [scope, setScope] = useState<JobScope>("upcoming");
  const me = useMe();
  const jobs = useJobs(scope);
  const tz = me.data?.company.timezone;
  const currency = me.data?.company.currency ?? "CAD";

  return (
    <Screen
      header={<ScreenHeader title="My jobs" />}
      bottomInset={TAB_BAR_HEIGHT}
      refreshing={jobs.isRefetching}
      onRefresh={() => jobs.refetch()}
    >
      <Segmented label="Which jobs" options={SCOPES} value={scope} onChange={setScope} />
      {jobs.isPending || !tz ? (
        <Loading label="Loading jobs" />
      ) : jobs.isError ? (
        <LoadError error={jobs.error} onRetry={() => jobs.refetch()} />
      ) : jobs.data.items.length === 0 ? (
        scope === "upcoming" ? (
          <Empty icon="jobs" title="Nothing booked yet" detail="Jobs the office gives you, and jobs you claim, show up here." />
        ) : (
          <Empty icon="jobs" title="No past jobs yet" />
        )
      ) : (
        groupByDay(jobs.data.items, tz).map(([day, items]) => (
          <View key={day} style={{ gap: space[3] }}>
            <Text variant="eyebrow" color="chrome" accessibilityRole="header" style={{ paddingLeft: RAIL_WIDTH + space[5] }}>
              {shortDate(items[0].startsAt, tz)}
            </Text>
            <View style={{ gap: space[3] }}>
              <RailLine />
              {items.map((job) => (
                <TimelineRow key={job.id} job={job} timeZone={tz} currency={currency} />
              ))}
            </View>
          </View>
        ))
      )}
    </Screen>
  );
}

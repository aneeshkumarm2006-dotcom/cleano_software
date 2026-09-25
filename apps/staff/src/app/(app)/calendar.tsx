import type { JobSummary } from "@bookmops/api/v1";
import { Button, Card, color, IconButton, MonthGrid, monthGridRange, monthTitle, parseDateKey, radius, space, Text } from "@bookmops/ui-native";
import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";

import { LoadError, Loading } from "@/components/QueryState";
import { useJobsBetween, useMe } from "@/data/queries";
import { BackHeader, Page } from "@/features/record/ui";
import { addressLine } from "@/lib/directions";
import { keyWeekdayDayMonth } from "@/lib/dates";
import { clockTime, formatMoneyWhole, localDateKey } from "@/lib/format";
import { useNow } from "@/lib/use-now";

/**
 * The cleaner's own jobs by month. Days with work carry a dot; tapping a day
 * lists its jobs underneath, and each opens the job. All dates are the
 * company's, whatever zone the phone is in.
 */
export default function Calendar() {
  const me = useMe();
  const tz = me.data?.company.timezone;
  if (tz) return <Month timeZone={tz} currency={me.data?.company.currency ?? "CAD"} />;
  return (
    <Page header={<BackHeader title="Calendar" />}>
      <Loading label="Loading your calendar" />
    </Page>
  );
}

function Month({ timeZone, currency }: { timeZone: string; currency: string }) {
  const now = useNow(60_000);
  const today = localDateKey(now.toISOString(), timeZone);
  const t = parseDateKey(today)!;
  const [month, setMonth] = useState({ year: t.year, month: t.month });
  const [selected, setSelected] = useState(today);
  const range = monthGridRange(month.year, month.month);
  const jobs = useJobsBetween(range.from, range.to);

  const byDay = useMemo(() => {
    const map = new Map<string, JobSummary[]>();
    // Last month's jobs, kept while this month loads, don't belong on this grid.
    if (jobs.isPlaceholderData) return map;
    for (const job of jobs.data ?? []) {
      if (job.status === "CANCELLED") continue;
      const key = localDateKey(job.startsAt, timeZone);
      const list = map.get(key);
      if (list) list.push(job);
      else map.set(key, [job]);
    }
    return map;
  }, [jobs.data, jobs.isPlaceholderData, timeZone]);
  const marked = useMemo(() => new Set(byDay.keys()), [byDay]);
  // Stable while the jobs are, so the memoised grid isn't redrawn every minute.
  const describe = useCallback(
    (key: string) => {
      const n = byDay.get(key)?.length ?? 0;
      return n ? `${n} ${n === 1 ? "job" : "jobs"}` : "no jobs";
    },
    [byDay],
  );
  const dayJobs = byDay.get(selected) ?? [];

  function shift(dir: 1 | -1) {
    const n = month.month + dir;
    const next = n < 1 ? { year: month.year - 1, month: 12 } : n > 12 ? { year: month.year + 1, month: 1 } : { year: month.year, month: n };
    setMonth(next);
    // Keep the selection inside the month being looked at: today if it's
    // this month, otherwise the 1st.
    const isThisMonth = next.year === t.year && next.month === t.month;
    setSelected(isThisMonth ? today : `${next.year}-${String(next.month).padStart(2, "0")}-01`);
  }

  const minutes = dayJobs.reduce((sum, j) => sum + (j.endsAt ? (new Date(j.endsAt).getTime() - new Date(j.startsAt).getTime()) / 60_000 : 0), 0);
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  const hours = minutes > 0 ? (m ? `${h}h ${String(m).padStart(2, "0")}` : `${h}h`) : null;

  return (
    <Page header={<BackHeader title="Calendar" />} refreshing={jobs.isRefetching} onRefresh={() => jobs.refetch()}>
      <View style={{ backgroundColor: color.surface, borderRadius: radius.xxl, borderWidth: 1, borderColor: color.line, padding: space[4], gap: space[3] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Text variant="subheading" accessibilityRole="header" style={{ flex: 1 }}>
            {monthTitle(month.year, month.month)}
          </Text>
          <IconButton icon="back" label="Previous month" onPress={() => shift(-1)} />
          <IconButton icon="forward" label="Next month" onPress={() => shift(1)} />
        </View>
        <MonthGrid
          year={month.year}
          month={month.month}
          today={today}
          selected={selected}
          marked={marked}
          onSelect={setSelected}
          describe={describe}
        />
      </View>

      {month.year !== t.year || month.month !== t.month ? (
        <Button
          label="Back to today"
          variant="secondary"
          size="md"
          onPress={() => {
            setMonth({ year: t.year, month: t.month });
            setSelected(today);
          }}
        />
      ) : null}

      <View style={{ flexDirection: "row", alignItems: "baseline", gap: space[3], paddingLeft: space[1] }}>
        <Text variant="eyebrow" color="chrome" accessibilityRole="header">
          {selected === today ? `Today · ${keyWeekdayDayMonth(selected)}` : keyWeekdayDayMonth(selected)}
        </Text>
        {dayJobs.length > 0 ? (
          <Text variant="small" color="ink3" numeral>
            {[`${dayJobs.length} ${dayJobs.length === 1 ? "job" : "jobs"}`, hours].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
      </View>

      {jobs.isPending || jobs.isPlaceholderData ? (
        <Loading label="Loading jobs" />
      ) : jobs.isError ? (
        <LoadError error={jobs.error} onRetry={() => jobs.refetch()} />
      ) : dayJobs.length === 0 ? (
        <Text variant="body" color="ink2" style={{ paddingLeft: space[1] }}>
          {selected < today ? "You had no jobs this day." : "No jobs booked this day."}
        </Text>
      ) : (
        <View style={{ gap: space[2] }}>
          {dayJobs.map((job) => (
            <Card
              key={job.id}
              padding={4}
              onPress={() => router.push({ pathname: "/jobs/[id]", params: { id: job.id } })}
              accessibilityLabel={`${clockTime(job.startsAt, timeZone)}, ${addressLine(job.address)}, ${job.service.label}`}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
                <Text variant="subheading" color="chrome" numeral style={{ width: 54 }}>
                  {clockTime(job.startsAt, timeZone)}
                </Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {job.address.line1}
                  </Text>
                  <Text variant="small" color="ink2" numberOfLines={1}>
                    {[job.service.label, job.address.area].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                {job.payCents != null ? (
                  <Text variant="bodyStrong" color="success" numeral>
                    {formatMoneyWhole(job.payCents, currency)}
                  </Text>
                ) : null}
              </View>
            </Card>
          ))}
        </View>
      )}
    </Page>
  );
}

import { IconButton, Screen, space, StatStrip, TAB_BAR_HEIGHT, Text } from "@bookmops/ui-native";
import { router } from "expo-router";
import { View } from "react-native";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useMe, useToday } from "@/data/queries";
import { RailLine, RAIL_WIDTH, TimelineRow } from "@/features/jobs/TimelineRow";
import { NotificationsPrimer } from "@/features/notifications/NotificationsPrimer";
import { NextJobCard } from "@/features/today/NextJobCard";
import { duration, formatMoneyWhole, longDate, partOfDay } from "@/lib/format";
import { useNow } from "@/lib/use-now";

export default function Today() {
  const me = useMe();
  const today = useToday();
  const now = useNow();

  const tz = me.data?.company.timezone;
  const currency = me.data?.company.currency ?? "CAD";
  const firstName = me.data?.person.name.split(" ")[0];

  const header = (
    <ScreenHeader
      eyebrow={tz ? longDate(now.toISOString(), tz) : " "}
      title={tz && firstName ? `${partOfDay(now, tz)}, ${firstName}` : "Today"}
      actions={
        <>
          <IconButton icon="notifications" label="Notifications" dot={!!today.data?.unread.notifications} />
          <IconButton icon="chat" label="Chat with the office" tone="chrome" count={today.data?.unread.office} onPress={() => router.push("/chat")} />
        </>
      }
    />
  );

  return (
    <Screen header={header} bottomInset={TAB_BAR_HEIGHT} refreshing={today.isRefetching} onRefresh={() => today.refetch()}>
      {today.isPending || me.isPending ? (
        <Loading label="Loading today" />
      ) : today.isError || me.isError ? (
        <LoadError
          error={today.error ?? me.error}
          onRetry={() => {
            me.refetch();
            today.refetch();
          }}
        />
      ) : (
        <TodayBody data={today.data} now={now} timeZone={tz!} currency={currency} />
      )}
    </Screen>
  );
}

function TodayBody({
  data,
  now,
  timeZone,
  currency,
}: {
  data: NonNullable<ReturnType<typeof useToday>["data"]>;
  now: Date;
  timeZone: string;
  currency: string;
}) {
  const later = data.laterToday;
  const laterMs = later.reduce(
    (sum, j) => sum + (j.endsAt ? new Date(j.endsAt).getTime() - new Date(j.startsAt).getTime() : 0),
    0,
  );

  return (
    <>
      {data.nextJob ? (
        <NextJobCard job={data.nextJob} now={now} timeZone={timeZone} currency={currency} />
      ) : (
        <Empty icon="today" title="No more jobs today" detail="Anything new the office gives you will show up here." />
      )}

      <NotificationsPrimer />

      <StatStrip
        stats={[
          { label: "Hours", value: data.week.hours.toFixed(1).replace(/\.0$/, "") },
          { label: "Jobs", value: String(data.week.jobs) },
          { label: "This week", value: formatMoneyWhole(data.week.earningsCents, currency), tone: "success" },
        ]}
      />

      {later.length > 0 ? (
        <View style={{ gap: space[3] }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: space[3], paddingLeft: RAIL_WIDTH + space[5] }}>
            <Text variant="eyebrow" color="ink3" accessibilityRole="header">
              Later today
            </Text>
            <Text variant="small" weight="semibold" color="ink3" numeral>
              {later.length} more{laterMs ? ` · ${duration(laterMs)}` : ""}
            </Text>
          </View>
          <View style={{ gap: space[3] }}>
            <RailLine />
            {later.map((job) => (
              <TimelineRow key={job.id} job={job} timeZone={timeZone} currency={currency} />
            ))}
          </View>
        </View>
      ) : null}
    </>
  );
}

import { addDays, Button, IconButton, Screen, space, TAB_BAR_HEIGHT, Text } from "@bookmops/ui-native";
import { useState } from "react";
import { View } from "react-native";

import { Guarded } from "@/components/Guarded";
import { LoadError, Loading } from "@/components/QueryState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useMe, useTeamDay } from "@/data/queries";
import { TeamDayView } from "@/features/manage/TeamDay";
import { useLive } from "@/features/messages/use-live";
import { keyWeekdayDayMonth } from "@/lib/dates";
import { localDateKey } from "@/lib/format";
import { useNow } from "@/lib/use-now";

/** The team's jobs one day at a time, on the same rail as Today. */
export default function Schedule() {
  return (
    <Guarded need="TEAM_VIEW">
      <ScheduleDays />
    </Guarded>
  );
}

function ScheduleDays() {
  const me = useMe();
  const now = useNow();
  const live = useLive();
  const tz = me.data?.company.timezone;
  const today = tz ? localDateKey(now.toISOString(), tz) : null;
  const [picked, setPicked] = useState<string | null>(null);
  const date = picked ?? today;
  const isToday = date === today;
  const day = useTeamDay(date, live && isToday);

  return (
    <Screen header={<ScreenHeader title="Schedule" />} bottomInset={TAB_BAR_HEIGHT} refreshing={day.isRefetching} onRefresh={() => day.refetch()}>
      {date ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <IconButton icon="back" label="Previous day" onPress={() => setPicked(addDays(date, -1))} />
          <View style={{ flex: 1, alignItems: "center" }} accessible accessibilityRole="header" accessibilityLabel={isToday ? `Today, ${keyWeekdayDayMonth(date)}` : keyWeekdayDayMonth(date)}>
            <Text variant="subheading" numeral>
              {keyWeekdayDayMonth(date)}
            </Text>
            <Text variant="small" color="ink3">
              {isToday ? "Today" : " "}
            </Text>
          </View>
          <IconButton icon="forward" label="Next day" onPress={() => setPicked(addDays(date, 1))} />
        </View>
      ) : null}
      {!isToday && date ? <Button label="Back to today" variant="secondary" size="md" icon="today" onPress={() => setPicked(null)} /> : null}
      {day.isPending || !tz || !date ? (
        <Loading label="Loading the schedule" />
      ) : day.isError ? (
        <LoadError error={day.error} onRetry={() => day.refetch()} />
      ) : (
        <>
          {day.data.scope === "OWN" ? (
            <Text variant="small" color="ink2" align="center">
              Other days show only the jobs you're on. Today shows everyone's.
            </Text>
          ) : null}
          <TeamDayView data={day.data} timeZone={tz} live={isToday} />
        </>
      )}
    </Screen>
  );
}

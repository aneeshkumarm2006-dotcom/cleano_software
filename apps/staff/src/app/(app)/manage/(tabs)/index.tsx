import { Screen, TAB_BAR_HEIGHT } from "@bookmops/ui-native";

import { Guarded } from "@/components/Guarded";
import { LoadError, Loading } from "@/components/QueryState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useMe, useTeamDay } from "@/data/queries";
import { useLive } from "@/features/messages/use-live";
import { TeamDayView } from "@/features/manage/TeamDay";
import { longDate } from "@/lib/format";
import { useNow } from "@/lib/use-now";

/** The office's Today: who's where, what needs someone, and the day's jobs on the rail. */
export default function ManagerToday() {
  return (
    <Guarded need="TEAM_VIEW">
      <TeamToday />
    </Guarded>
  );
}

function TeamToday() {
  const me = useMe();
  const live = useLive();
  const now = useNow();
  const day = useTeamDay(null, live);
  const tz = me.data?.company.timezone;

  const header = (
    <ScreenHeader
      eyebrow={tz ? longDate(now.toISOString(), tz) : " "}
      title="Team today"
    />
  );

  return (
    <Screen header={header} bottomInset={TAB_BAR_HEIGHT} refreshing={day.isRefetching} onRefresh={() => day.refetch()}>
      {day.isPending || !tz ? (
        <Loading label="Loading the team's day" />
      ) : day.isError ? (
        <LoadError error={day.error} onRetry={() => day.refetch()} />
      ) : (
        <TeamDayView data={day.data} timeZone={tz} live />
      )}
    </Screen>
  );
}

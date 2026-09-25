import { Guarded } from "@/components/Guarded";
import { LoadError, Loading } from "@/components/QueryState";
import { useMe, useTeamDay } from "@/data/queries";
import { useStaffRole } from "@/data/role";
import { TeamDayView } from "@/features/manage/TeamDay";
import { useLive } from "@/features/messages/use-live";
import { BackHeader, Page } from "@/features/record/ui";

/**
 * Team today, opened from More: a field lead's group (the office roles have
 * it as their Today tab). Same view, same rules: the server decides whose
 * work is in it.
 */
export default function TeamTodayScreen() {
  return (
    <Guarded need="TEAM_VIEW">
      <TeamToday />
    </Guarded>
  );
}

function TeamToday() {
  const me = useMe();
  const live = useLive();
  const role = useStaffRole();
  const day = useTeamDay(null, live);
  const tz = me.data?.company.timezone;

  return (
    <Page
      header={<BackHeader title="Team today" subtitle={role.scope === "GROUP" ? "Your group" : undefined} fallback={role.home} />}
      refreshing={day.isRefetching}
      onRefresh={() => day.refetch()}
    >
      {day.isPending || !tz ? (
        <Loading label="Loading the team's day" />
      ) : day.isError ? (
        <LoadError error={day.error} onRetry={() => day.refetch()} />
      ) : (
        <TeamDayView data={day.data} timeZone={tz} live />
      )}
    </Page>
  );
}

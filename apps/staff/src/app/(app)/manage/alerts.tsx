import { Button, Segmented, space } from "@bookmops/ui-native";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { Guarded } from "@/components/Guarded";
import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useAlerts, useIssues, useLateArrivals, useMarkAlertsRead, useMe } from "@/data/queries";
import { useStaffRole } from "@/data/role";
import { MoreButton } from "@/features/manage/Approvals";
import { AlertRow, IssueRow, LateRow } from "@/features/manage/Inbox";
import { BackHeader, Page, SectionTitle } from "@/features/record/ui";
import { useNow } from "@/lib/use-now";

type Section = "alerts" | "late" | "problems";

/**
 * What the office should know about: the feed the web's Notifications page
 * shows, cleaners who clocked in late, and, for owners and admins, the
 * problems cleaners reported (urgent first).
 */
export default function AlertsScreen() {
  return (
    <Guarded need={["ALERTS", "ISSUES"]}>
      <Alerts />
    </Guarded>
  );
}

function Alerts() {
  const me = useMe();
  const role = useStaffRole();
  const now = useNow();
  const tz = me.data?.company.timezone;
  const options = [
    role.can("ALERTS") ? { value: "alerts" as const, label: "Alerts" } : null,
    role.can("ALERTS") ? { value: "late" as const, label: "Late" } : null,
    role.can("ISSUES") ? { value: "problems" as const, label: "Problems" } : null,
  ].filter((o): o is { value: Section; label: string } => !!o);
  // "?show=problems" opens straight on the problems, from More.
  const { show } = useLocalSearchParams<{ show?: string }>();
  const [picked, setPicked] = useState<Section | null>(options.some((o) => o.value === show) ? (show as Section) : null);
  const view = picked ?? options[0]?.value ?? "alerts";

  return (
    <Page header={<BackHeader title="Alerts" fallback={role.home} />}>
      {options.length > 1 ? <Segmented label="Which alerts" options={options} value={view} onChange={setPicked} /> : null}
      {!tz ? (
        <Loading label="Loading alerts" />
      ) : view === "alerts" ? (
        <Feed timeZone={tz} now={now} />
      ) : view === "late" ? (
        <Late timeZone={tz} />
      ) : (
        <Problems timeZone={tz} now={now} />
      )}
    </Page>
  );
}

function Feed({ timeZone, now }: { timeZone: string; now: Date }) {
  const role = useStaffRole();
  const alerts = useAlerts();
  const markRead = useMarkAlertsRead();
  if (alerts.isPending) return <Loading label="Loading alerts" />;
  if (alerts.isError) return <LoadError error={alerts.error} onRetry={() => alerts.refetch()} />;
  const items = alerts.data.pages.flatMap((p) => p.items);
  const unread = items.filter((a) => !a.read).map((a) => a.id);
  if (items.length === 0) return <Empty icon="notifications" title="Nothing new" detail="Dropped shifts, clocks left running and requests from cleaners show up here." />;
  return (
    <>
      {unread.length > 0 ? (
        <View style={{ alignItems: "flex-end" }}>
          <Button label="Mark all read" variant="secondary" size="md" icon="tick" loading={markRead.isPending} onPress={() => markRead.mutate(unread)} />
        </View>
      ) : null}
      {items.map((a) => (
        <AlertRow
          key={a.id}
          alert={a}
          timeZone={timeZone}
          now={now}
          onPress={() => {
            if (!a.read) markRead.mutate([a.id]);
            if (a.jobId && role.can("TEAM_VIEW")) router.push({ pathname: "/manage/jobs/[id]", params: { id: a.jobId } });
          }}
        />
      ))}
      <MoreButton query={alerts} />
    </>
  );
}

function Late({ timeZone }: { timeZone: string }) {
  const role = useStaffRole();
  const late = useLateArrivals();
  if (late.isPending) return <Loading label="Loading late arrivals" />;
  if (late.isError) return <LoadError error={late.error} onRetry={() => late.refetch()} />;
  const items = late.data.pages.flatMap((p) => p.items);
  if (items.length === 0) return <Empty icon="clock" title="Nobody late in the last 30 days" />;
  return (
    <View style={{ gap: space[3] }}>
      {items.map((l) => (
        <LateRow key={l.id} late={l} timeZone={timeZone} canOpen={role.can("TEAM_VIEW")} />
      ))}
      <MoreButton query={late} />
    </View>
  );
}

function Problems({ timeZone, now }: { timeZone: string; now: Date }) {
  const open = useIssues("open");
  const resolved = useIssues("resolved");
  if (open.isPending) return <Loading label="Loading problems" />;
  if (open.isError) return <LoadError error={open.error} onRetry={() => open.refetch()} />;
  const items = open.data.pages.flatMap((p) => p.items);
  const recent = resolved.data?.pages[0]?.items.slice(0, 5) ?? [];
  return (
    <>
      {items.length === 0 ? (
        <Empty icon="check" title="No open problems" detail="When a cleaner reports one, it shows here, urgent first." />
      ) : (
        items.map((i) => <IssueRow key={i.id} issue={i} timeZone={timeZone} now={now} />)
      )}
      <MoreButton query={open} />
      {recent.length > 0 ? (
        <>
          <SectionTitle>Recently resolved</SectionTitle>
          {recent.map((i) => (
            <IssueRow key={i.id} issue={i} timeZone={timeZone} now={now} />
          ))}
        </>
      ) : null}
    </>
  );
}

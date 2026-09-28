import type { ManagerJobResponse } from "@bookmops/api/v1";
import { Button, Card, color, Icon, Pill, radius, space, Text } from "@bookmops/ui-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { Linking, View } from "react-native";

import { Guarded } from "@/components/Guarded";
import { LoadError, Loading } from "@/components/QueryState";
import { useManagerJob, useMe } from "@/data/queries";
import { useStaffRole } from "@/data/role";
import { attention, crewState, issueCategory, issueStatus, jobStatus } from "@/features/manage/words";
import { BackHeader, Notice, Page, SectionTitle } from "@/features/record/ui";
import { clockTime, duration, shortDate } from "@/lib/format";
import { safeWebUrl } from "@/lib/urls";

/** One job, as the office sees it. What the role may not see is left out, never shown empty. */
export default function ManagerJobScreen() {
  return (
    <Guarded need="TEAM_VIEW">
      <ManagerJob />
    </Guarded>
  );
}

function ManagerJob() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const role = useStaffRole();
  const job = useManagerJob(id);
  const tz = me.data?.company.timezone;
  const back = role.side === "office" ? "/manage" : "/manage/team";

  return (
    <Page
      header={
        <BackHeader
          title={job.data ? `Job #${job.data.jobNumber}` : "Job"}
          subtitle={job.data && tz ? shortDate(job.data.startsAt, tz) : undefined}
          fallback={back}
        />
      }
      refreshing={job.isRefetching}
      onRefresh={() => job.refetch()}
    >
      {job.isPending || !tz ? (
        <Loading label="Loading job" />
      ) : job.isError ? (
        <LoadError error={job.error} onRetry={() => job.refetch()} />
      ) : (
        <JobBody job={job.data} timeZone={tz} />
      )}
    </Page>
  );
}

const EVENT_TEXT: Record<string, string> = {
  CLOCK_IN: "Clocked in",
  CLOCK_OUT: "Clocked out",
  BREAK_START: "Started a break",
  BREAK_END: "Ended a break",
};

function JobBody({ job, timeZone }: { job: ManagerJobResponse; timeZone: string }) {
  const status = jobStatus(job.status);
  const minutes = job.endsAt ? Math.round((new Date(job.endsAt).getTime() - new Date(job.startsAt).getTime()) / 60_000) : null;
  const phone = job.client.phone?.replace(/[^\d+]/g, "") || null;
  const email = job.client.email && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(job.client.email) ? job.client.email : null;
  const photos = (job.photos ?? []).flatMap((p) => {
    const url = safeWebUrl(p.url);
    return url ? [{ ...p, url }] : [];
  });

  return (
    <>
      <View style={{ gap: space[1] }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[3] }}>
          <Text variant="title" accessibilityRole="header" style={{ flex: 1 }}>
            {job.address.line1 ?? job.address.area ?? "Address on the web"}
          </Text>
          <View style={{ marginTop: space[2] }}>
            <Pill label={status.label} tone={status.tone} />
          </View>
        </View>
        <Text variant="body" color="ink2">
          {[job.address.line2, job.address.line1 ? job.address.area : null, job.service.label].filter(Boolean).join(" · ")}
        </Text>
      </View>

      {job.attention.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
          {job.attention.map((a) => {
            const t = attention(a);
            return t ? <Pill key={a} label={t.label} tone={t.tone} /> : null;
          })}
        </View>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
        <Fact label="Starts" value={clockTime(job.startsAt, timeZone)} />
        <Fact label="Length" value={minutes ? duration(minutes * 60_000) : "—"} />
        <Fact label="Cleaners" value={`${job.staffing.assigned} of ${job.staffing.required}`} tone={job.staffing.assigned < job.staffing.required ? "danger" : undefined} />
        <Fact label="Start time" value={job.isFlexible ? "Flexible" : "Fixed"} small />
      </View>

      <Card padding={4}>
        <View style={{ gap: space[1] }}>
          <Text variant="eyebrow" color="ink3">
            Client
          </Text>
          <Text variant="bodyStrong">{job.client.name}</Text>
        </View>
        {phone || email ? (
          <View style={{ flexDirection: "row", gap: space[2], marginTop: space[3] }}>
            {phone ? <Button label="Call" icon="phone" variant="secondary" size="md" style={{ flex: 1 }} onPress={() => void Linking.openURL(`tel:${phone}`)} /> : null}
            {email ? <Button label="Email" icon="mail" variant="secondary" size="md" style={{ flex: 1 }} onPress={() => void Linking.openURL(`mailto:${email}`)} /> : null}
          </View>
        ) : null}
      </Card>

      {job.notes ? (
        <Card padding={4} style={{ backgroundColor: color.warningSoft, borderColor: color.warningSoft }}>
          <View style={{ flexDirection: "row", gap: space[3] }}>
            <Icon name="info" size={22} color="warning" />
            <View style={{ flex: 1, gap: space[1] }}>
              <Text variant="eyebrow" color="warning">
                Office notes
              </Text>
              <Text variant="body">{job.notes}</Text>
            </View>
          </View>
        </Card>
      ) : null}

      <SectionTitle>Crew</SectionTitle>
      <Card padding={4}>
        {job.crew.length === 0 ? (
          <Text variant="body" color="ink2">
            Nobody is on this job yet.
          </Text>
        ) : (
          <View style={{ gap: space[3] }}>
            {job.crew.map((c) => {
              const s = crewState(c.state);
              return (
                <View key={c.id} style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong">
                      {c.name}
                      {c.isLead ? " · lead" : ""}
                    </Text>
                    <Text variant="small" color="ink2" numeral>
                      {c.outsideGroup
                        ? "Another group's cleaner"
                        : [
                            c.tier === "TRAINEE" ? "Trainee" : null,
                            c.clockedInAt ? `In ${clockTime(c.clockedInAt, timeZone)}` : null,
                            c.clockedOutAt ? `out ${clockTime(c.clockedOutAt, timeZone)}` : null,
                            c.minutesLate ? `${c.minutesLate} min late` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Not clocked in"}
                    </Text>
                  </View>
                  {c.outsideGroup ? null : <Pill label={s.label} tone={s.tone} />}
                </View>
              );
            })}
          </View>
        )}
      </Card>
      {job.can.setCrew ? (
        <Button
          label={job.crew.length ? "Change crew" : "Assign cleaners"}
          icon="team"
          variant="secondary"
          onPress={() => router.push({ pathname: "/manage/jobs/[id]/crew", params: { id: job.id } })}
        />
      ) : job.can.addCleaner ? (
        <Button
          label="Add a cleaner"
          icon="add"
          variant="secondary"
          onPress={() => router.push({ pathname: "/manage/jobs/[id]/crew", params: { id: job.id } })}
        />
      ) : null}

      {job.clockEvents ? (
        <>
          <SectionTitle>Clock</SectionTitle>
          <Card padding={4}>
            {job.clockEvents.length === 0 ? (
              <Text variant="body" color="ink2">
                Nobody has clocked in yet.
              </Text>
            ) : (
              <View style={{ gap: space[3] }}>
                {job.clockEvents.map((e, i) => (
                  <View key={`${e.cleanerId}-${e.kind}-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
                    <Text variant="bodyStrong" color="chrome" numeral style={{ width: 52 }}>
                      {clockTime(e.at, timeZone)}
                    </Text>
                    <Text variant="body" style={{ flex: 1 }}>
                      {e.cleanerName} · {EVENT_TEXT[e.kind] ?? "Clock"}
                    </Text>
                    {e.pendingReview ? <Pill label="With the office" tone="warning" /> : null}
                  </View>
                ))}
              </View>
            )}
          </Card>
        </>
      ) : null}

      {job.checklist ? (
        <Card padding={4}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
            <Icon name="check" size={22} color="accentText" />
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              Checklist
            </Text>
            <Text variant="bodyStrong" color="ink2" numeral>
              {job.checklist.done}/{job.checklist.total}
            </Text>
          </View>
        </Card>
      ) : null}

      {job.photos ? (
        <>
          <SectionTitle>{`Photos · ${photos.length}`}</SectionTitle>
          {photos.length === 0 ? (
            <Text variant="body" color="ink2" style={{ paddingLeft: space[1] }}>
              No photos yet.
            </Text>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
              {photos.map((p) => (
                <Image
                  key={p.id}
                  source={{ uri: p.url }}
                  accessible
                  accessibilityLabel={`${p.kind === "BEFORE" ? "Before" : p.kind === "AFTER" ? "After" : "Photo"}, by ${p.takenBy}, ${clockTime(p.takenAt, timeZone)}`}
                  style={{ width: 96, height: 96, borderRadius: radius.md, backgroundColor: color.groundDeep }}
                  contentFit="cover"
                />
              ))}
            </View>
          )}
        </>
      ) : null}

      {job.issues && job.issues.length > 0 ? (
        <>
          <SectionTitle>Problems reported</SectionTitle>
          {job.issues.map((i) => {
            const s = issueStatus(i.status);
            return (
              <IssueLink key={i.id} id={i.id} title={issueCategory(i.category)} detail={`${i.reportedBy} · ${i.note}`} urgent={i.urgency === "URGENT"} status={s} />
            );
          })}
        </>
      ) : null}

      {!job.clockEvents ? (
        <Notice tone="neutral" icon="info">
          Clock times, photos and the checklist for this job are on the web console.
        </Notice>
      ) : null}
    </>
  );
}

function IssueLink({
  id,
  title,
  detail,
  urgent,
  status,
}: {
  id: string;
  title: string;
  detail: string;
  urgent: boolean;
  status: ReturnType<typeof issueStatus>;
}) {
  const role = useStaffRole();
  const open = role.can("ISSUES") ? () => router.push({ pathname: "/manage/issues/[id]", params: { id } }) : undefined;
  return (
    <Card padding={4} onPress={open} accessible accessibilityLabel={`${urgent ? "Urgent. " : ""}${title}. ${status.label}. ${detail}`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {title}
        </Text>
        {urgent ? <Pill label="Urgent" tone="danger" /> : null}
        <Pill label={status.label} tone={status.tone} />
      </View>
      <Text variant="small" color="ink2" numberOfLines={2} style={{ marginTop: space[1] }}>
        {detail}
      </Text>
    </Card>
  );
}

function Fact({ label, value, tone, small }: { label: string; value: string; tone?: "danger"; small?: boolean }) {
  return (
    <View
      style={{
        flexBasis: "47%",
        flexGrow: 1,
        padding: space[4],
        gap: space[1],
        borderRadius: radius.lg,
        backgroundColor: color.surface,
        borderWidth: 1,
        borderColor: color.line,
      }}
    >
      <Text variant="eyebrow" color="ink3">
        {label}
      </Text>
      <Text variant={small ? "bodyStrong" : "heading"} color={tone ?? "chrome"} numeral numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}


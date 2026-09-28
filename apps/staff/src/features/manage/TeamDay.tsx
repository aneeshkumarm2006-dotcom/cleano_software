import type { CrewState, TeamDayResponse, TeamJob } from "@bookmops/api/v1";
import { Card, color, Pill, type PillTone, space, StatStrip, Text } from "@bookmops/ui-native";
import { router } from "expo-router";
import { View } from "react-native";

import { Empty } from "@/components/QueryState";
import { SectionTitle } from "@/features/record/ui";
import { RailLine, RAIL_WIDTH } from "@/features/jobs/TimelineRow";
import { clockTime, hourMark } from "@/lib/format";

import { attention, crewState, jobStatus, shortName } from "./words";

const TONE_COLOR: Record<PillTone, string> = {
  accent: color.accent,
  success: color.success,
  warning: color.warning,
  danger: color.danger,
  neutral: color.lineStrong,
};

const openJob = (id: string) => router.push({ pathname: "/manage/jobs/[id]", params: { id } });

/** "12:40 to 15:40", or the start alone. */
function span(job: TeamJob, timeZone: string): string {
  return job.endsAt ? `${clockTime(job.startsAt, timeZone)} to ${clockTime(job.endsAt, timeZone)}` : clockTime(job.startsAt, timeZone);
}

/** Where the job is, as far as this viewer may see it: the street, or the area for a field lead. */
function place(job: TeamJob): string {
  return job.address.line1 ?? job.address.area ?? "Address on the web";
}

/** The day's people at a glance: who's in, on a break, late, not in yet. */
export function PeopleStrip({ people }: { people: TeamDayResponse["people"] }) {
  const count = (s: CrewState) => people.filter((p) => p.state === s).length;
  const late = count("LATE");
  return (
    <StatStrip
      stats={[
        { label: "Clocked in", value: String(count("CLOCKED_IN")) },
        { label: "On break", value: String(count("ON_BREAK")), tone: count("ON_BREAK") ? "warning" : "chrome" },
        { label: "Late", value: String(late), tone: late ? "danger" : "chrome" },
        { label: "Not in yet", value: String(count("NOT_STARTED")) },
      ]}
    />
  );
}

/** One crew member on a job: a filled dot for their state, their name, the state in words. */
function CrewLine({ member, timeZone }: { member: TeamJob["crew"][number]; timeZone: string }) {
  const s = crewState(member.state);
  const since = member.state === "CLOCKED_IN" && member.clockedInAt ? ` ${clockTime(member.clockedInAt, timeZone)}` : "";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: TONE_COLOR[s.tone] }} />
      <Text variant="small" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
        {shortName(member.name)}
        {member.isLead ? " (lead)" : ""}
      </Text>
      <Text variant="small" color={s.tone === "danger" ? "danger" : s.tone === "warning" ? "warning" : "ink2"} numeral>
        {s.label}
        {since}
        {member.minutesLate ? ` · ${member.minutesLate} min late` : ""}
      </Text>
    </View>
  );
}

function spokenJob(job: TeamJob, timeZone: string): string {
  const flags = job.attention.map((a) => attention(a)?.label).filter(Boolean);
  const crew = job.crew.length
    ? job.crew.map((c) => `${c.name} ${crewState(c.state).label}`).join(", ")
    : "No cleaner assigned";
  return [span(job, timeZone), place(job), job.client.name, job.service.label, crew, ...flags].join(". ");
}

/**
 * A job hanging off the day rail, as on the cleaner's Today: the hour on the
 * left, a dot on the line, and a card. The dot is filled by where the job
 * stands (done, running, or needing someone), never a coloured stripe.
 */
export function TeamJobRow({ job, timeZone }: { job: TeamJob; timeZone: string }) {
  const done = job.status === "COMPLETED" || job.status === "PAID";
  const running = job.crew.some((c) => c.state === "CLOCKED_IN" || c.state === "ON_BREAK");
  const alarm = job.attention.includes("UNASSIGNED") || job.attention.includes("LATE_START");
  const dot = done ? color.lineStrong : alarm ? color.danger : running ? color.accent : color.surface;
  const status = jobStatus(job.status);

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
      <View style={{ width: RAIL_WIDTH, paddingTop: space[3] + 1, paddingRight: space[2] }}>
        <Text variant="small" weight="bold" color="ink3" numeral align="right">
          {hourMark(job.startsAt, timeZone)}
        </Text>
      </View>
      <View
        style={{
          position: "absolute",
          left: RAIL_WIDTH - 4,
          top: space[4],
          width: 9,
          height: 9,
          borderRadius: 5,
          backgroundColor: dot,
          borderWidth: 2,
          borderColor: dot === color.surface ? color.ink3 : dot,
        }}
      />
      <View style={{ width: space[5] }} />
      <Card style={{ flex: 1 }} padding={4} onPress={() => openJob(job.id)} accessibilityLabel={spokenJob(job, timeZone)}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: space[2] }}>
          <Text variant="subheading" color="chrome" numeral>
            {clockTime(job.startsAt, timeZone)}
          </Text>
          {job.endsAt ? (
            <Text variant="small" color="ink3" numeral>
              to {clockTime(job.endsAt, timeZone)}
            </Text>
          ) : null}
          <View style={{ flex: 1 }} />
          <Pill label={status.label} tone={status.tone} />
        </View>
        <Text variant="bodyStrong" style={{ marginTop: space[1] }} numberOfLines={1}>
          {place(job)}
        </Text>
        <Text variant="small" color="ink2" numberOfLines={1}>
          {[job.client.name, job.service.label, job.isFlexible ? "Flexible" : null].filter(Boolean).join(" · ")}
        </Text>
        {job.attention.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1], marginTop: space[2] }}>
            {job.attention.map((a) => {
              const t = attention(a);
              if (!t) return null;
              const label = a === "SHORT_STAFFED" ? `${job.staffing.assigned} of ${job.staffing.required} cleaners` : t.label;
              return <Pill key={a} label={label} tone={t.tone} />;
            })}
          </View>
        ) : null}
        {job.crew.length ? (
          <View style={{ gap: space[1], marginTop: space[2] }}>
            {job.crew.map((c) => (
              <CrewLine key={c.id} member={c} timeZone={timeZone} />
            ))}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

/** The whole day on one rail. */
export function DayRail({ jobs, timeZone }: { jobs: readonly TeamJob[]; timeZone: string }) {
  return (
    <View style={{ gap: space[3] }}>
      <RailLine />
      {jobs.map((job) => (
        <TeamJobRow key={job.id} job={job} timeZone={timeZone} />
      ))}
    </View>
  );
}

/** A compact card for the "needs someone" list at the top of Today. */
function AttentionCard({ job, timeZone }: { job: TeamJob; timeZone: string }) {
  return (
    <Card padding={4} onPress={() => openJob(job.id)} accessibilityLabel={spokenJob(job, timeZone)}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <Text variant="bodyStrong" color="chrome" numeral>
          {clockTime(job.startsAt, timeZone)}
        </Text>
        <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
          {place(job)}
        </Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1], marginTop: space[2] }}>
        {job.attention.map((a) => {
          const t = attention(a);
          if (!t) return null;
          const label = a === "SHORT_STAFFED" ? `${job.staffing.assigned} of ${job.staffing.required} cleaners` : t.label;
          return <Pill key={a} label={label} tone={t.tone} />;
        })}
      </View>
    </Card>
  );
}

/**
 * The team's day: who's where, what needs someone, then every job on the
 * rail. Shared by the manager's Today, the field lead's Team today, and each
 * day of the Schedule (which leaves the summary off for days not today).
 */
export function TeamDayView({
  data,
  timeZone,
  live,
}: {
  data: TeamDayResponse;
  timeZone: string;
  /** Today: the live summary and the "needs someone" list. */
  live: boolean;
}) {
  const needs = data.jobs.filter((j) => j.attention.length > 0 && j.status !== "COMPLETED" && j.status !== "PAID");
  return (
    <>
      {live && data.people.length > 0 ? <PeopleStrip people={data.people} /> : null}
      {live && needs.length > 0 ? (
        <View style={{ gap: space[3] }}>
          <SectionTitle>{`Needs someone · ${needs.length}`}</SectionTitle>
          {needs.map((j) => (
            <AttentionCard key={j.id} job={j} timeZone={timeZone} />
          ))}
        </View>
      ) : null}
      {data.jobs.length === 0 ? (
        <Empty
          icon="jobs"
          title="No jobs this day"
          detail={
            data.scope === "GROUP"
              ? "Nobody in your group is booked this day."
              : data.scope === "OWN"
                ? "You're not on any jobs this day."
                : "Nothing is booked for this day."
          }
        />
      ) : (
        <View style={{ gap: space[3] }}>
          <Text variant="eyebrow" color="ink3" accessibilityRole="header" style={{ paddingLeft: RAIL_WIDTH + space[5] }}>
            {`${data.jobs.length} ${data.jobs.length === 1 ? "job" : "jobs"}`}
          </Text>
          <DayRail jobs={data.jobs} timeZone={timeZone} />
        </View>
      )}
    </>
  );
}

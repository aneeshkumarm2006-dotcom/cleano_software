import type { Alert, LateArrival, ManagedIssue } from "@bookmops/api/v1";
import { Card, color, Icon, type IconName, Pill, radius, space, Text } from "@bookmops/ui-native";
import { router } from "expo-router";
import { View } from "react-native";

import { dayMonth } from "@/lib/dates";
import { clockTime } from "@/lib/format";

import { issueCategory, issueStatus } from "./words";

const SEVERITY: Record<string, { icon: IconName; tile: string; tint: "danger" | "warning" | "accentText" }> = {
  ERROR: { icon: "warning", tile: color.dangerSoft, tint: "danger" },
  WARN: { icon: "flag", tile: color.warningSoft, tint: "warning" },
  INFO: { icon: "info", tile: color.accentSoft, tint: "accentText" },
};

/** "14:05" today, "22 Sep" before. */
function when(iso: string, timeZone: string, now: Date): string {
  return dayMonth(iso, timeZone) === dayMonth(now.toISOString(), timeZone) ? clockTime(iso, timeZone) : dayMonth(iso, timeZone);
}

/** One entry in the office's feed. Its weight is the tile's fill, and an unread one says "New". */
export function AlertRow({ alert, timeZone, now, onPress }: { alert: Alert; timeZone: string; now: Date; onPress: () => void }) {
  const s = SEVERITY[alert.severity] ?? SEVERITY.INFO!;
  return (
    <Card
      padding={4}
      onPress={onPress}
      accessibilityLabel={`${alert.read ? "" : "New. "}${alert.title}. ${alert.body ?? ""} ${when(alert.createdAt, timeZone, now)}`}
      accessibilityHint={alert.jobId ? "Opens the job" : undefined}
    >
      <View style={{ flexDirection: "row", gap: space[3], alignItems: "flex-start" }}>
        <View style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: s.tile, alignItems: "center", justifyContent: "center" }}>
          <Icon name={s.icon} size={20} color={s.tint} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Text variant={alert.read ? "body" : "bodyStrong"} style={{ flex: 1 }}>
              {alert.title}
            </Text>
            <Text variant="small" color="ink3" numeral>
              {when(alert.createdAt, timeZone, now)}
            </Text>
          </View>
          {alert.body ? (
            <Text variant="small" color="ink2" numberOfLines={2}>
              {alert.body}
            </Text>
          ) : null}
          {!alert.read ? (
            <View style={{ flexDirection: "row", marginTop: space[1] }}>
              <Pill label="New" tone="accent" />
            </View>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

/** A cleaner who clocked in late: the rule the web emails the office about. */
export function LateRow({ late, timeZone, canOpen }: { late: LateArrival; timeZone: string; canOpen: boolean }) {
  return (
    <Card
      padding={4}
      onPress={canOpen ? () => router.push({ pathname: "/manage/jobs/[id]", params: { id: late.job.id } }) : undefined}
      accessible
      accessibilityLabel={`${late.cleaner.name}, ${late.minutesLate} minutes late, job ${late.job.jobNumber}, ${dayMonth(late.job.startsAt, timeZone)}${late.strike ? ", a strike" : ""}`}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
          {late.cleaner.name}
        </Text>
        <Pill label={`${late.minutesLate} min late`} tone={late.strike ? "danger" : "warning"} />
      </View>
      <Text variant="small" color="ink2" numeral>
        {[
          `#${late.job.jobNumber}`,
          late.job.area,
          `${dayMonth(late.job.startsAt, timeZone)} · due ${clockTime(late.job.startsAt, timeZone)}, in ${clockTime(late.clockedInAt, timeZone)}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      {late.strike || late.ratingPenalty ? (
        <Text variant="small" color="ink3" style={{ marginTop: space[1] }}>
          {[late.ratingPenalty ? `Rating −${late.ratingPenalty} on this job` : null, late.strike ? "A strike (45 minutes or more)" : null]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      ) : null}
    </Card>
  );
}

/** A problem a cleaner reported. Urgent ones say so first. */
export function IssueRow({ issue, timeZone, now }: { issue: ManagedIssue; timeZone: string; now: Date }) {
  const s = issueStatus(issue.status);
  const urgent = issue.urgency === "URGENT" && issue.status !== "RESOLVED";
  return (
    <Card
      padding={4}
      onPress={() => router.push({ pathname: "/manage/issues/[id]", params: { id: issue.id } })}
      accessibilityLabel={`${urgent ? "Urgent. " : ""}${issueCategory(issue.category)}. ${s.label}. ${issue.reportedBy}, job ${issue.job.jobNumber}. ${issue.note}`}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
          {issueCategory(issue.category)}
        </Text>
        {urgent ? <Pill label="Urgent" tone="danger" /> : null}
        <Pill label={s.label} tone={s.tone} />
      </View>
      <Text variant="small" color="ink2" numeral numberOfLines={1}>
        {[issue.reportedBy, `#${issue.job.jobNumber}`, issue.job.clientName, when(issue.reportedAt, timeZone, now)].join(" · ")}
      </Text>
      <Text variant="body" numberOfLines={2} style={{ marginTop: space[1] }}>
        {issue.note}
      </Text>
    </Card>
  );
}

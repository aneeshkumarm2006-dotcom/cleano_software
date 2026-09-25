import type { StrikeItem, StrikesResponse } from "@bookmops/api/v1";
import { Card, color, Icon, minTouch, radius, space, Text } from "@bookmops/ui-native";
import { router } from "expo-router";
import { Pressable, View } from "react-native";

import { LoadError, Loading } from "@/components/QueryState";
import { useMe, useStrikes } from "@/data/queries";
import { BackHeader, Page, SectionTitle, Tag, type Tone } from "@/features/record/ui";
import { dayMonthYear } from "@/lib/dates";

const STANDING: Record<string, { title: string; tone: Tone; icon: "standing" | "warning" }> = {
  OK: { title: "Good standing", tone: "ok", icon: "standing" },
  WARNING: { title: "Strikes on your record", tone: "warn", icon: "warning" },
  REVIEW: { title: "Under review", tone: "critical", icon: "warning" },
};

const PAST: Record<string, { label: string; tone: Tone }> = {
  EXPIRED: { label: "Rolled off", tone: "neutral" },
  EXCUSED: { label: "Excused", tone: "ok" },
  REMOVED: { label: "Removed", tone: "ok" },
};

/**
 * My standing: the cleaner's strike record, stated plainly. What counts now,
 * when each strike rolls off, what happens at the limit, and how to query one.
 */
export default function Strikes() {
  const me = useMe();
  const strikes = useStrikes();
  const tz = me.data?.company.timezone;

  return (
    <Page header={<BackHeader title="My standing" />} refreshing={strikes.isRefetching} onRefresh={() => strikes.refetch()}>
      {strikes.isPending || !tz ? (
        <Loading label="Loading your standing" />
      ) : strikes.isError ? (
        <LoadError error={strikes.error} onRetry={() => strikes.refetch()} />
      ) : (
        <Record data={strikes.data} timeZone={tz} />
      )}
    </Page>
  );
}

function Record({ data, timeZone }: { data: StrikesResponse; timeZone: string }) {
  const standing = STANDING[data.level] ?? STANDING.OK!;
  const active = data.items.filter((s) => s.status === "ACTIVE");
  const past = data.items.filter((s) => s.status !== "ACTIVE");
  const left = Math.max(0, data.threshold - data.activeCount);
  const fill = standing.tone === "critical" ? color.danger : color.warning;
  const soft = { ok: color.successSoft, warn: color.warningSoft, critical: color.dangerSoft, neutral: color.groundDeep, accent: color.accentSoft }[standing.tone];
  const fg = ({ ok: "success", warn: "warning", critical: "danger", neutral: "ink2", accent: "accentText" } as const)[standing.tone];

  return (
    <>
      <Card padding={5}>
        <View style={{ gap: space[4] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
            <View style={{ width: 46, height: 46, borderRadius: radius.lg, backgroundColor: soft, alignItems: "center", justifyContent: "center" }}>
              <Icon name={standing.icon} size={24} color={fg} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="subheading" accessibilityRole="header">
                {standing.title}
              </Text>
              <Text variant="small" color="ink2" numeral>
                {data.activeCount} active {data.activeCount === 1 ? "strike" : "strikes"} of {data.threshold}
              </Text>
            </View>
          </View>
          <View
            accessible
            accessibilityLabel={`${data.activeCount} of ${data.threshold} strikes active`}
            style={{ flexDirection: "row", gap: space[2] }}
          >
            {Array.from({ length: data.threshold }, (_, i) => (
              <View key={i} style={{ flex: 1, height: 8, borderRadius: radius.pill, backgroundColor: i < data.activeCount ? fill : color.groundDeep }} />
            ))}
          </View>
          <Text variant="small" color="ink2" style={{ lineHeight: 19 }}>
            {data.level === "REVIEW"
              ? "You've reached the limit, so an admin will review your account. Your schedule doesn't change while that happens; they'll contact you."
              : data.activeCount === 0
                ? "Nothing active. Keep it that way and there's nothing to do here."
                : `${left} more would start a review with an admin.`}
          </Text>
        </View>
      </Card>

      <View style={{ gap: space[2], paddingHorizontal: space[1] }}>
        <Text variant="bodyStrong" accessibilityRole="header">
          How strikes work
        </Text>
        <Text variant="small" color="ink2" style={{ lineHeight: 19 }}>
          A strike stays active for {data.windowDays} days, then rolls off on its own. There's nothing to apply for.
        </Text>
        <Text variant="small" color="ink2" style={{ lineHeight: 19 }}>
          At {data.threshold} active strikes an admin reviews your account. That's a conversation, not an automatic removal.
        </Text>
      </View>

      {active.length > 0 ? (
        <>
          <SectionTitle>Active</SectionTitle>
          {active.map((s) => (
            <StrikeCard key={s.id} strike={s} timeZone={timeZone} active />
          ))}
        </>
      ) : null}

      {past.length > 0 ? (
        <>
          <SectionTitle>Past</SectionTitle>
          {past.map((s) => (
            <StrikeCard key={s.id} strike={s} timeZone={timeZone} />
          ))}
        </>
      ) : null}

      {data.items.length === 0 ? (
        <Text variant="body" color="ink2" style={{ paddingHorizontal: space[1] }}>
          No strikes on your record. Arrive on time and finish your checklists and it stays that way.
        </Text>
      ) : null}

      <Card padding={4}>
        <View style={{ flexDirection: "row", gap: space[3], alignItems: "flex-start" }}>
          <Icon name="chat" size={22} color="accentText" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">Think a strike is wrong?</Text>
            <Text variant="small" color="ink2">
              Running late for a reason you told the office about, for example? Message the office in Office chat and an admin can excuse it.
            </Text>
          </View>
        </View>
      </Card>
    </>
  );
}

function StrikeCard({ strike: s, timeZone, active }: { strike: StrikeItem; timeZone: string; active?: boolean }) {
  const past = PAST[s.status] ?? PAST.EXPIRED!;
  // The recorded reason usually starts with the rule's own words; show only what it adds.
  const detail = s.reason.startsWith(s.title) ? s.reason.slice(s.title.length).replace(/^\s*[—–-]\s*/, "") : s.reason;
  return (
    <Card
      padding={4}
      style={active ? { backgroundColor: color.warningSoft, borderColor: color.warningSoft } : undefined}
    >
      <View style={{ gap: space[2] }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[3] }}>
          <Text variant="bodyStrong" style={{ flex: 1 }} color={active ? "ink" : "ink2"}>
            {s.title}
          </Text>
          {active ? null : <Tag label={past.label} tone={past.tone} />}
        </View>
        {detail ? (
          <Text variant="body" color={active ? "ink" : "ink2"}>
            {detail.charAt(0).toUpperCase() + detail.slice(1)}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], flexWrap: "wrap" }}>
          <Text variant="small" color="ink2" numeral>
            Given {dayMonthYear(s.givenAt, timeZone)}
          </Text>
          {active ? (
            <Text variant="small" weight="bold" color="warning" numeral>
              Rolls off {dayMonthYear(s.expiresAt, timeZone)}
            </Text>
          ) : null}
          {s.job ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Open job ${s.job.number}`}
              hitSlop={8}
              onPress={() => router.push({ pathname: "/jobs/[id]", params: { id: s.job!.id } })}
              style={{ minHeight: minTouch, justifyContent: "center" }}
            >
              <Text variant="small" weight="bold" color="accentText" numeral>
                Job #{s.job.number}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

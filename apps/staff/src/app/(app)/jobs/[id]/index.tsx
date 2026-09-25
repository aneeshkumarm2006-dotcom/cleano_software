import type { JobDetailResponse } from "@bookmops/api/v1";
import { Button, Card, color, Icon, IconButton, radius, space, Text } from "@bookmops/ui-native";
import { router, useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoadError, Loading } from "@/components/QueryState";
import { useJob, useMe } from "@/data/queries";
import { addressLine, openDirections } from "@/lib/directions";
import { clockTime, duration, formatMoney, shortDate } from "@/lib/format";

export default function JobDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const job = useJob(id);
  const tz = me.data?.company.timezone;

  return (
    <View style={{ flex: 1, backgroundColor: color.ground }}>
      <View style={{ paddingTop: insets.top + space[2], paddingHorizontal: space[4], flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <IconButton icon="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        <Text variant="eyebrow" color="ink3" style={{ flex: 1 }}>
          {job.data && tz ? shortDate(job.data.startsAt, tz) : ""}
        </Text>
      </View>

      {job.isPending || !tz ? (
        <Loading label="Loading job" />
      ) : job.isError ? (
        <View style={{ padding: space[4] }}>
          <LoadError error={job.error} onRetry={() => job.refetch()} />
        </View>
      ) : (
        <Detail job={job.data} timeZone={tz} currency={me.data?.company.currency ?? "CAD"} myId={me.data?.person.id} bottom={insets.bottom} />
      )}
    </View>
  );
}

function Detail({
  job,
  timeZone,
  currency,
  myId,
  bottom,
}: {
  job: JobDetailResponse;
  timeZone: string;
  currency: string;
  myId?: string;
  bottom: number;
}) {
  const minutes =
    job.plannedMinutes ??
    (job.endsAt ? Math.round((new Date(job.endsAt).getTime() - new Date(job.startsAt).getTime()) / 60_000) : null);
  const others = job.crew.filter((c) => c.id !== myId);
  const lead = job.crew.find((c) => c.isLead);

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: 120 + bottom }} showsVerticalScrollIndicator={false}>
        <View style={{ gap: space[1] }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[3] }}>
            <Text variant="title" accessibilityRole="header" style={{ flex: 1 }}>
              {job.address.line1}
            </Text>
            <StatusPill status={job.status} />
          </View>
          <Text variant="body" color="ink2">
            {[job.address.line2, job.address.area].filter(Boolean).join(" · ")}
          </Text>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
          <Fact label="Starts" value={clockTime(job.startsAt, timeZone)} />
          <Fact label="Duration" value={minutes ? duration(minutes * 60_000) : "—"} />
          <Fact label="Your pay" value={job.payCents != null ? formatMoney(job.payCents, currency) : "—"} tone="success" />
          <Fact label="Service" value={job.service.label} small />
        </View>

        <Button label="Get directions" variant="secondary" icon="directions" onPress={() => openDirections(addressLine(job.address))} />

        {job.notes ? (
          <Card padding={4} style={{ backgroundColor: color.warningSoft, borderColor: color.warningSoft }}>
            <View style={{ flexDirection: "row", gap: space[3] }}>
              <Icon name="info" size={22} color="warning" />
              <View style={{ flex: 1, gap: space[1] }}>
                <Text variant="eyebrow" color="warning">
                  From the office
                </Text>
                <Text variant="body">{job.notes}</Text>
              </View>
            </View>
          </Card>
        ) : null}

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

        {job.crew.length > 0 ? (
          <Card padding={4}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
              <Icon name="team" size={22} color="accentText" />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">
                  {others.length === 0 ? "Just you" : `You and ${others.map((c) => c.name.split(" ")[0]).join(", ")}`}
                </Text>
                {lead ? (
                  <Text variant="small" color="ink2">
                    {lead.id === myId ? "You're the lead on this one" : `${lead.name.split(" ")[0]} is the lead on this one`}
                  </Text>
                ) : null}
              </View>
            </View>
          </Card>
        ) : null}

        {job.client.firstName ? (
          <Text variant="small" color="ink3" align="center">
            Client: {job.client.firstName}
          </Text>
        ) : null}
      </ScrollView>

      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: space[4],
          paddingTop: space[3],
          paddingBottom: bottom + space[3],
          backgroundColor: color.surface,
          borderTopWidth: 1,
          borderTopColor: color.line,
          gap: space[2],
        }}
      >
        <Button
          label={job.clock.state === "CLOCKED_IN" || job.clock.state === "ON_BREAK" ? "Open the clock" : job.clock.state === "CLOCKED_OUT" ? "View time" : "Clock in"}
          onPress={() => router.push({ pathname: "/jobs/[id]/clock", params: { id: job.id } })}
        />
      </View>
    </>
  );
}

function Fact({ label, value, tone, small }: { label: string; value: string; tone?: "success"; small?: boolean }) {
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
      <Text variant="eyebrow" color="ink3" style={{ fontSize: 10 }}>
        {label}
      </Text>
      <Text variant={small ? "bodyStrong" : "heading"} color={tone ?? "chrome"} numeral numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const STATUS_TEXT: Record<string, { label: string; fg: "accentText" | "success" | "danger" | "ink2"; bg: string }> = {
  SCHEDULED: { label: "Scheduled", fg: "accentText", bg: color.accentSoft },
  CREATED: { label: "Scheduled", fg: "accentText", bg: color.accentSoft },
  IN_PROGRESS: { label: "In progress", fg: "accentText", bg: color.accentSoft },
  COMPLETED: { label: "Done", fg: "success", bg: color.successSoft },
  PAID: { label: "Paid", fg: "success", bg: color.successSoft },
  CANCELLED: { label: "Cancelled", fg: "danger", bg: color.dangerSoft },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_TEXT[status] ?? { label: "Job", fg: "ink2" as const, bg: color.groundDeep };
  return (
    <View style={{ paddingHorizontal: space[2] + 2, paddingVertical: space[1], borderRadius: radius.pill, backgroundColor: s.bg, marginTop: space[1] }}>
      <Text variant="eyebrow" color={s.fg} style={{ fontSize: 10 }}>
        {s.label}
      </Text>
    </View>
  );
}

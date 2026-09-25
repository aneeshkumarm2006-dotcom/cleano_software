import type { AvailableJobDetailResponse } from "@bookmops/api/v1";
import { Button, Card, color, Icon, Pill, radius, space, Text, type IconName } from "@bookmops/ui-native";
import { useLocalSearchParams } from "expo-router";
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BackButton, goBackOr } from "@/components/BackButton";
import { LoadError, Loading } from "@/components/QueryState";
import { useAvailableJob, useMe } from "@/data/queries";
import { useClaimFlow } from "@/features/available/useClaimFlow";
import { dayLabel, lengthText, payText, soonText } from "@/features/available/words";
import { clockTime } from "@/lib/format";
import { useNow } from "@/lib/use-now";

/**
 * An open job, before claiming: what a cleaner needs to decide, and nothing
 * that belongs only to the crew. The street address, the client and the way
 * in arrive once the job is theirs (see @bookmops/api v1/available.ts).
 */
export default function AvailableJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const job = useAvailableJob(id);
  const tz = me.data?.company.timezone;

  return (
    <View style={{ flex: 1, backgroundColor: color.ground }}>
      <View style={{ paddingTop: insets.top + space[3], paddingHorizontal: space[4], flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <BackButton fallback="/available" />
        <Text variant="eyebrow" color="ink3" style={{ flex: 1 }}>
          Open job
        </Text>
      </View>

      {job.isPending || me.isPending ? (
        <Loading label="Loading job" />
      ) : job.isError || me.isError || !tz ? (
        <View style={{ padding: space[4] }}>
          <LoadError
            error={job.error ?? me.error}
            onRetry={() => {
              void me.refetch();
              void job.refetch();
            }}
          />
          <Button label="Back to open jobs" variant="secondary" size="md" style={{ marginTop: space[3] }} onPress={() => goBackOr("/available")} />
        </View>
      ) : (
        <Detail job={job.data} timeZone={tz} currency={me.data?.company.currency ?? "CAD"} bottom={insets.bottom} />
      )}
    </View>
  );
}

function Detail({ job, timeZone, currency, bottom }: { job: AvailableJobDetailResponse; timeZone: string; currency: string; bottom: number }) {
  const now = useNow();
  const { ask, claimingId } = useClaimFlow({ timeZone, currency, from: "detail" });
  const pay = payText(job.pay, currency);
  const soon = soonText(job.startsAt, now);
  const p = job.property;
  const property = [
    p.type,
    p.beds != null ? `${p.beds} bed` : null,
    p.baths != null ? `${p.baths} bath` : null,
    p.halfBaths ? `${p.halfBaths} half bath` : null,
    p.squareFeet ? `${p.squareFeet.toLocaleString("en-CA")} sq ft` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: 120 + bottom }} showsVerticalScrollIndicator={false}>
        <View style={{ gap: space[2] }}>
          {soon ? <Pill label={soon} tone="warning" /> : null}
          <Text variant="title" accessibilityRole="header">
            {job.area ?? "Area not given"}
          </Text>
          <Text variant="body" color="ink2">
            {job.service.label}
          </Text>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
          <Fact
            label={dayLabel(job.startsAt, timeZone, now)}
            value={`${clockTime(job.startsAt, timeZone)}${job.endsAt ? `–${clockTime(job.endsAt, timeZone)}` : ""}`}
            note={job.isFlexible ? "Flexible start" : undefined}
          />
          <Fact label="Length" value={job.plannedMinutes ? lengthText(job) : "TBC"} note={job.plannedMinutes ? undefined : "Set by the office"} />
          <Fact
            label="Your pay"
            value={pay ?? "TBC"}
            tone={pay ? "success" : undefined}
            note={job.pay.type === "HOURLY" ? "Paid on hours worked" : pay ? "Estimate" : "Set when you're assigned"}
          />
          <Fact
            label="Spots left"
            value={`${Math.max(0, job.crew.required - job.crew.claimed)} of ${job.crew.required}`}
            note={job.crew.required <= 1 ? "Solo job" : `${job.crew.claimed} already on it`}
          />
        </View>

        <Card padding={4} style={{ backgroundColor: color.accentSofter, borderColor: color.accentSoft }}>
          <View style={{ flexDirection: "row", gap: space[3], alignItems: "flex-start" }}>
            <Icon name="lock" size={20} color="accentText" />
            <Text variant="small" color="ink2" style={{ flex: 1 }}>
              You'll see the full address and how to get in once the job is yours.
            </Text>
          </View>
        </Card>

        {property ? <Section icon="home" title="The place" body={property} /> : null}

        {job.addOns.length > 0 ? (
          <Section icon="extras" title={`Add-ons (${job.addOns.length})`}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
              {job.addOns.map((a) => (
                <View
                  key={a.name}
                  style={{ paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.sm, backgroundColor: color.ground, borderWidth: 1, borderColor: color.line }}
                >
                  <Text variant="small" weight="semibold">
                    {a.name}
                    {a.quantity > 1 ? ` ×${a.quantity}` : ""}
                  </Text>
                </View>
              ))}
            </View>
          </Section>
        ) : null}

        <Section icon="check" title="Checklist">
          {job.checklists.length === 0 ? (
            <Text variant="small" color="ink2">
              No checklist for this kind of job.
            </Text>
          ) : (
            job.checklists.map((c) => (
              <Text key={c.name} variant="small" color="ink2">
                <Text variant="small" weight="semibold" color="ink">
                  {c.name}
                </Text>
                {` · ${c.itemCount} item${c.itemCount === 1 ? "" : "s"}${c.requiredCount ? `, ${c.requiredCount} required` : ""}`}
              </Text>
            ))
          )}
        </Section>

        <Section icon="info" title="Instructions" body={job.notes ?? "None from the office."} />
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
        }}
      >
        <Button label="Claim this job" loading={claimingId === job.id} onPress={() => ask(job)} accessibilityHint="Asks you to confirm first" />
      </View>
    </>
  );
}

function Fact({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "success";
}) {
  return (
    <View
      accessible
      accessibilityLabel={[label, value, note].filter(Boolean).join(", ")}
      style={{ flexBasis: "47%", flexGrow: 1, padding: space[4], gap: space[1], borderRadius: radius.lg, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line }}
    >
      <Text variant="eyebrow" color="ink3">
        {label}
      </Text>
      <Text variant="heading" color={tone ?? "chrome"} numeral numberOfLines={1}>
        {value}
      </Text>
      {note ? (
        <Text variant="small" color="ink3" numberOfLines={1}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

function Section({ icon, title, body, children }: { icon: IconName; title: string; body?: string; children?: ReactNode }) {
  return (
    <Card padding={4}>
      <View style={{ flexDirection: "row", gap: space[3] }}>
        <Icon name={icon} size={20} color="accentText" />
        <View style={{ flex: 1, gap: space[2] }}>
          <Text variant="eyebrow" color="ink3" accessibilityRole="header">
            {title}
          </Text>
          {body ? <Text variant="body">{body}</Text> : null}
          {children}
        </View>
      </View>
    </Card>
  );
}

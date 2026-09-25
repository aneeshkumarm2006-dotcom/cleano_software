import type { AvailableJobSummary } from "@bookmops/api/v1";
import { Button, color, minTouch, Pill, radius, space, Text } from "@bookmops/ui-native";
import { router } from "expo-router";
import { Pressable, View } from "react-native";

import { RAIL_WIDTH } from "@/features/jobs/TimelineRow";
import { clockTime, hourMark } from "@/lib/format";

import { lengthText, payText, propertyText, soonText, spotsText } from "./words";

/**
 * One open job on the day rail, the Jobs screen's row with what a cleaner
 * weighs before claiming: when, where (the area only), how much, and how many
 * are needed. The card opens the preview; the button claims.
 */
export function AvailableRow({
  job,
  timeZone,
  currency,
  now,
  emphasis,
  claiming,
  onClaim,
}: {
  job: AvailableJobSummary;
  timeZone: string;
  currency: string;
  now: Date;
  /** The soonest job gets the filled button: importance is fill. */
  emphasis: boolean;
  claiming: boolean;
  onClaim: () => void;
}) {
  const pay = payText(job.pay, currency);
  const soon = soonText(job.startsAt, now);
  const property = propertyText(job.property);
  const time = `${clockTime(job.startsAt, timeZone)}${job.endsAt ? ` to ${clockTime(job.endsAt, timeZone)}` : ""}`;

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
      <View style={{ width: RAIL_WIDTH, paddingTop: space[4] + 1, paddingRight: space[2] }}>
        <Text variant="small" weight="bold" color="ink3" numeral align="right">
          {hourMark(job.startsAt, timeZone)}
        </Text>
      </View>
      <View
        style={{
          position: "absolute",
          left: RAIL_WIDTH - 4,
          top: space[5],
          width: 9,
          height: 9,
          borderRadius: 5,
          backgroundColor: soon ? color.warning : color.surface,
          borderWidth: 2,
          borderColor: soon ? color.warning : color.ink3,
        }}
      />
      <View style={{ width: space[5] }} />

      <View
        style={{
          flex: 1,
          backgroundColor: color.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: color.line,
          overflow: "hidden",
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={[
            time,
            job.area ?? "Area not given",
            job.service.label,
            pay ? `your pay ${pay}` : "pay set by the office",
            spotsText(job.crew),
            soon,
          ]
            .filter(Boolean)
            .join(", ")}
          accessibilityHint="Opens the job's details"
          onPress={() => router.push({ pathname: "/available/[id]", params: { id: job.id } })}
          style={({ pressed }) => ({ padding: space[4], gap: space[1], backgroundColor: pressed ? color.groundDeep : color.surface })}
        >
          {soon ? (
            <View style={{ marginBottom: space[1] }}>
              <Pill label={soon} tone="warning" />
            </View>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[3] }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="subheading" color="chrome" numeral>
                {time}
              </Text>
              <Text variant="bodyStrong" numberOfLines={1}>
                {job.area ?? "Area not given"}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text variant="heading" color={pay ? "success" : "ink3"} numeral style={pay ? { fontSize: 22, lineHeight: 26 } : undefined}>
                {pay ?? "TBC"}
              </Text>
              <Text variant="eyebrow" color="accentText" numeral style={{ fontSize: 10 }}>
                {lengthText(job)}
              </Text>
            </View>
          </View>
          <Text variant="small" color="ink2" numberOfLines={1}>
            {[job.service.label, property].filter(Boolean).join(" · ")}
          </Text>
          <View style={{ flexDirection: "row", gap: space[2], marginTop: space[1] }}>
            <Pill label={spotsText(job.crew)} tone="neutral" />
            {job.isFlexible ? <Pill label="Flexible start" tone="neutral" /> : null}
          </View>
        </Pressable>
        <View style={{ paddingHorizontal: space[4], paddingBottom: space[4] }}>
          <Button
            label="Claim this job"
            variant={emphasis ? "primary" : "secondary"}
            size="md"
            loading={claiming}
            onPress={onClaim}
            accessibilityLabel={`Claim the ${time} job${job.area ? ` in ${job.area}` : ""}`}
            accessibilityHint="Asks you to confirm first"
            style={{ minHeight: minTouch }}
          />
        </View>
      </View>
    </View>
  );
}

/** The vertical line the rows hang from, lined up with this row's dot. */
export function AvailableRailLine() {
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", left: RAIL_WIDTH, top: space[5], bottom: space[5], width: 1.5, backgroundColor: color.line }}
    />
  );
}

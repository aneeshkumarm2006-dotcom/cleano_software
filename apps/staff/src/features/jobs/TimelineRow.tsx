import type { JobSummary } from "@bookmops/api/v1";
import { Card, color, space, Text } from "@bookmops/ui-native";
import { router } from "expo-router";
import { View } from "react-native";

import { addressLine } from "@/lib/directions";
import { clockTime, formatMoney, hourMark } from "@/lib/format";

/** Width of the hour column on the day rail. */
export const RAIL_WIDTH = 40;

/**
 * One job hanging off the day rail: the hour on the left, a dot on the line,
 * and a quiet card. Time is the spine of the list, not a field in each card.
 */
export function TimelineRow({ job, timeZone, currency }: { job: JobSummary; timeZone: string; currency: string }) {
  const done = job.status === "COMPLETED" || job.status === "PAID";
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
          backgroundColor: done ? color.lineStrong : color.surface,
          borderWidth: 2,
          borderColor: done ? color.lineStrong : color.ink3,
        }}
      />
      <View style={{ width: space[5] }} />
      <Card
        style={{ flex: 1 }}
        padding={4}
        onPress={() => router.push({ pathname: "/jobs/[id]", params: { id: job.id } })}
        accessibilityLabel={`${clockTime(job.startsAt, timeZone)}, ${addressLine(job.address)}, ${job.service.label}`}
      >
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
          {job.payCents != null ? (
            <Text variant="bodyStrong" color="success" numeral>
              {formatMoney(job.payCents, currency)}
            </Text>
          ) : null}
        </View>
        <Text variant="bodyStrong" style={{ marginTop: space[1] }} numberOfLines={1}>
          {job.address.line1}
        </Text>
        <Text variant="small" color="ink2" numberOfLines={1}>
          {[job.service.label, job.address.area].filter(Boolean).join(" · ")}
        </Text>
      </Card>
    </View>
  );
}

/** The vertical line the rows hang from. Render behind a column of rows. */
export function RailLine() {
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", left: RAIL_WIDTH, top: space[4], bottom: space[4], width: 1.5, backgroundColor: color.line }}
    />
  );
}

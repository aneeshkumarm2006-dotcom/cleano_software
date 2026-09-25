import type { JobSummary } from "@bookmops/api/v1";
import { Button, Card, IconButton, space, Text } from "@bookmops/ui-native";
import { router } from "expo-router";
import { View } from "react-native";

import { addressLine, openDirections } from "@/lib/directions";
import { clockTime, duration, formatMoney } from "@/lib/format";

/**
 * The one job that matters now, as the solid block: the job the cleaner is
 * clocked into, or the next to start. Everything else on the screen is quiet.
 */
export function NextJobCard({ job, now, timeZone, currency }: { job: JobSummary; now: Date; timeZone: string; currency: string }) {
  const onClock = job.clock.state === "CLOCKED_IN" || job.clock.state === "ON_BREAK";
  const startsInMs = new Date(job.startsAt).getTime() - now.getTime();
  const cue = onClock
    ? job.clock.state === "ON_BREAK"
      ? "ON A BREAK"
      : "ON THE CLOCK"
    : startsInMs > 0
      ? `STARTS IN ${duration(startsInMs).toUpperCase()}`
      : "STARTED";

  return (
    <Card tone="active" padding={5} accessibilityLabel={`Next job at ${clockTime(job.startsAt, timeZone)}, ${addressLine(job.address)}`}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text variant="eyebrow" color="onChrome3" style={{ flex: 1 }}>
          {onClock ? "Current job" : "Next job"}
        </Text>
        <Text variant="eyebrow" color="warningOnChrome" numeral accessibilityLiveRegion="polite">
          {cue}
        </Text>
      </View>

      <View style={{ flexDirection: "row", alignItems: "baseline", gap: space[2], marginTop: space[3] }}>
        <Text variant="display" color="onChrome" numeral>
          {clockTime(job.startsAt, timeZone)}
        </Text>
        {job.endsAt ? (
          <Text variant="bodyStrong" color="onChrome3" numeral>
            to {clockTime(job.endsAt, timeZone)}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        {job.payCents != null ? (
          <Text variant="heading" color="successOnChrome" numeral>
            {formatMoney(job.payCents, currency)}
          </Text>
        ) : null}
      </View>

      <Text variant="subheading" color="onChrome" style={{ marginTop: space[3] }}>
        {job.address.line1}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: space[1] }}>
        <Text variant="small" color="onChrome2" style={{ flex: 1 }} numberOfLines={1}>
          {[job.address.line2, job.address.area].filter(Boolean).join(" · ")}
        </Text>
        <Text variant="eyebrow" color="accentOnChrome">
          {job.service.label}
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: space[2], marginTop: space[4] }}>
        <Button
          label={onClock ? "Open job" : "Clock in"}
          variant="onChrome"
          style={{ flex: 1 }}
          onPress={() => router.push({ pathname: "/jobs/[id]/clock", params: { id: job.id } })}
        />
        <IconButton
          icon="directions"
          label="Get directions"
          tone="onChrome"
          onPress={() => openDirections(addressLine(job.address))}
        />
      </View>
    </Card>
  );
}

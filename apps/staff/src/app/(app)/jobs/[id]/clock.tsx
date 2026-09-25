import type { ChecklistItem, ClockStateResponse } from "@bookmops/api/v1";
import { Button, color, Icon, IconButton, ProgressRing, radius, space, Text, type IconName } from "@bookmops/ui-native";
import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoadError, Loading } from "@/components/QueryState";
import { useOutbox } from "@/data/outbox";
import { useClockActions } from "@/data/outbox/actions";
import { useChecklist, useClockState, useJob, useMe } from "@/data/queries";
import { breakMs, stopwatch, workedMs } from "@/lib/clock-math";
import { clockTime, duration } from "@/lib/format";
import { useNow } from "@/lib/use-now";

/**
 * The clock: the one screen a cleaner keeps open while working. Dark, so it
 * reads at a glance in a bright room and is kind to a battery left on all
 * shift. Everything on it acts immediately — the outbox saves each tap on the
 * phone and sends it when there is signal.
 */
export default function Clock() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const job = useJob(id);
  const clock = useClockState(id);
  const checklist = useChecklist(id);
  const tz = me.data?.company.timezone;

  return (
    <View style={{ flex: 1, backgroundColor: color.chrome, paddingTop: insets.top + space[2] }}>
      {/* A dark screen needs a light status bar, or the time vanishes. */}
      <StatusBar style="light" />
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4] }}>
        <IconButton icon="back" label="Back to the job" tone="onChrome" onPress={() => router.back()} />
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text variant="bodyStrong" color="onChrome" numberOfLines={1}>
            {job.data?.address.line1 ?? " "}
          </Text>
          <Text variant="small" color="onChrome3" numberOfLines={1}>
            {[job.data?.address.line2, job.data?.client.firstName].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <View style={{ width: 52 }} />
      </View>

      {clock.isPending || !tz ? (
        <Loading label="Loading the clock" />
      ) : clock.isError ? (
        <View style={{ padding: space[4] }}>
          <LoadError error={clock.error} onRetry={() => clock.refetch()} />
        </View>
      ) : (
        <ClockBody
          jobId={id}
          clock={clock.data}
          timeZone={tz}
          checklist={checklist.data?.items ?? []}
          bottomInset={insets.bottom}
        />
      )}
    </View>
  );
}

function ClockBody({
  jobId,
  clock,
  timeZone,
  checklist,
  bottomInset,
}: {
  jobId: string;
  clock: ClockStateResponse;
  timeZone: string;
  checklist: readonly ChecklistItem[];
  bottomInset: number;
}) {
  const now = useNow(1000);
  const actions = useClockActions(jobId);
  const outbox = useOutbox();

  const running = clock.state === "CLOCKED_IN" || clock.state === "ON_BREAK";
  const worked = workedMs(clock, now);
  const planned = clock.plannedMinutes ? clock.plannedMinutes * 60_000 : null;
  const remaining = planned != null ? planned - worked : null;

  const status =
    clock.state === "ON_BREAK"
      ? { label: "On a break", dot: color.warningOnChrome }
      : clock.state === "CLOCKED_IN"
        ? { label: "On the clock", dot: color.successOnChrome }
        : clock.state === "CLOCKED_OUT"
          ? { label: "Clocked out", dot: color.onChrome3 }
          : { label: "Not started", dot: color.onChrome3 };

  const syncLabel = outbox.failed.length
    ? "Needs attention"
    : outbox.paused === "signed-out"
      ? "Sign in to send"
      : outbox.pending
        ? "Saved on phone"
        : "Sent";

  const done = checklist.filter((i) => i.done).length;
  const upNext = checklist.filter((i) => !i.done).slice(0, 2);

  return (
    <>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 + bottomInset }} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: "center", marginTop: space[5] }}>
          <ProgressRing
            progress={planned ? worked / planned : 0}
            color={clock.state === "ON_BREAK" ? color.warningOnChrome : color.successOnChrome}
            trackColor={color.trackOnChrome}
            accessibilityLabel={`${status.label}. ${duration(worked)} worked${planned ? ` of ${duration(planned)}` : ""}.`}
          >
            <View style={{ alignItems: "center", gap: space[1] }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: status.dot }} />
                <Text variant="eyebrow" color="onChrome2">
                  {status.label}
                </Text>
              </View>
              <Text variant="display" color="onChrome" numeral style={{ fontSize: 50, lineHeight: 56 }}>
                {stopwatch(worked)}
              </Text>
              {remaining != null && running ? (
                <Text variant="small" color="onChrome3" numeral>
                  {remaining >= 0 ? `${duration(remaining)} still to run` : `${duration(-remaining)} over`}
                </Text>
              ) : null}
            </View>
          </ProgressRing>
        </View>

        {clock.pendingReview ? (
          <View style={{ marginHorizontal: space[4], marginTop: space[4], padding: space[3], borderRadius: radius.md, backgroundColor: color.warningWashOnChrome }}>
            <Text variant="small" color="warningOnChrome">
              A time you sent is with the office to confirm. You don't need to do anything.
            </Text>
          </View>
        ) : null}

        <View style={{ flexDirection: "row", marginHorizontal: space[4], marginTop: space[5] }}>
          <Stat label="Clocked in" value={clock.clockedInAt ? clockTime(clock.clockedInAt, timeZone) : "—"} />
          <Divider />
          <Stat label="Breaks" value={clock.breaks.length ? duration(breakMs(clock, now)) : "None"} />
          <Divider />
          <Stat
            label="Status"
            value={syncLabel}
            tone={outbox.failed.length ? color.warningOnChrome : outbox.pending ? color.onChrome : color.successOnChrome}
          />
        </View>

        {running ? (
          <View style={{ flexDirection: "row", marginHorizontal: space[4], marginTop: space[5], borderRadius: radius.xl, backgroundColor: color.panelOnChrome }}>
            <Action
              icon="clock"
              label={clock.state === "ON_BREAK" ? "End break" : "Break"}
              onPress={clock.state === "ON_BREAK" ? actions.endBreak : actions.startBreak}
            />
            <Divider />
            <Action
              icon="camera"
              label="Photos"
              onPress={() => router.push({ pathname: "/jobs/[id]/photos", params: { id: jobId } })}
            />
            <Divider />
            <Action
              icon="warning"
              label="Report issue"
              tone={color.warningOnChrome}
              onPress={() => router.push({ pathname: "/jobs/[id]/issue", params: { id: jobId } })}
            />
          </View>
        ) : null}

        {checklist.length ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Checklist, ${done} of ${checklist.length} done. Open the full list.`}
            onPress={() => router.push({ pathname: "/jobs/[id]/checklist", params: { id: jobId } })}
            style={{ marginHorizontal: space[4], marginTop: space[5] }}
          >
            <View style={{ flexDirection: "row", alignItems: "baseline" }}>
              <Text variant="eyebrow" color="onChrome3" style={{ flex: 1 }}>
                Checklist
              </Text>
              <Text variant="bodyStrong" color="onChrome" numeral>
                {done}
                <Text variant="bodyStrong" color="onChrome3">
                  {" "}
                  / {checklist.length}
                </Text>
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 4, marginTop: space[2] }}>
              {checklist.map((i) => (
                <View
                  key={i.id}
                  style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i.done ? color.successOnChrome : color.stepOnChrome }}
                />
              ))}
            </View>
            {upNext.map((item, n) => (
              <View key={item.id} style={{ flexDirection: "row", alignItems: "center", gap: space[3], marginTop: space[3] }}>
                <View style={{ width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: n === 0 ? color.accentOnChrome : color.outlineOnChrome }} />
                <Text variant={n === 0 ? "bodyStrong" : "body"} color={n === 0 ? "onChrome" : "onChrome2"} style={{ flex: 1 }} numberOfLines={1}>
                  {item.label}
                </Text>
                {n === 0 ? (
                  <Text variant="eyebrow" color="accentOnChrome" style={{ fontSize: 10 }}>
                    Up next
                  </Text>
                ) : null}
              </View>
            ))}
          </Pressable>
        ) : null}
      </ScrollView>

      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space[4], paddingBottom: bottomInset + space[4], paddingTop: space[3], backgroundColor: color.chrome }}>
        {clock.state === "NOT_STARTED" ? (
          <Button label="Clock in" variant="onChrome" onPress={actions.clockIn} />
        ) : running ? (
          <Button
            label="Clock out"
            variant="onChrome"
            onPress={() => router.push({ pathname: "/jobs/[id]/clock-out", params: { id: jobId } })}
          />
        ) : (
          <Button label="Back to today" variant="ghostOnChrome" onPress={() => router.dismissTo("/")} />
        )}
      </View>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center", gap: space[1] }}>
      <Text variant="eyebrow" color="onChrome3" style={{ fontSize: 10 }}>
        {label}
      </Text>
      <Text variant="bodyStrong" numeral style={{ color: tone ?? color.onChrome }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Divider() {
  return <View style={{ width: 1, backgroundColor: color.lineOnChrome }} />;
}

function Action({ icon, label, onPress, tone }: { icon: IconName; label: string; onPress: () => void; tone?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: 76,
        alignItems: "center",
        justifyContent: "center",
        gap: space[1],
        borderRadius: radius.xl,
        backgroundColor: pressed ? color.fillOnChrome : "transparent",
      })}
    >
      <Icon name={icon} size={22} color={tone ?? "onChrome"} />
      <Text variant="small" weight="bold" style={{ color: tone ?? color.onChrome }}>
        {label}
      </Text>
    </Pressable>
  );
}

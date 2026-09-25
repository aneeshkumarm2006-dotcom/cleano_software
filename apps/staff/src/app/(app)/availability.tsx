import { AVAILABILITY_DAYS, type AvailabilityDay, type AvailabilityResponse } from "@bookmops/api/v1";
import { Button, color, IconButton, radius, space, Text } from "@bookmops/ui-native";
import * as Haptics from "expo-haptics";
import { useNavigation } from "expo-router";
import { Fragment, useEffect, useState } from "react";
import { Alert, Pressable, Switch, View } from "react-native";

import { LoadError, Loading } from "@/components/QueryState";
import { useAvailability, useMe, useRemoveDaysOff, useSetWeek } from "@/data/queries";
import { DaysOffSheet } from "@/features/availability/DaysOffSheet";
import { groupDaysOff, show, toMinutes } from "@/features/availability/time";
import { TimeField } from "@/features/availability/TimeField";
import { BackHeader, confirm, errorText, FormError, Notice, Page, SectionTitle } from "@/features/record/ui";
import { dayCount, keyDayMonthYear, rangeLabel } from "@/lib/dates";
import { localDateKey } from "@/lib/format";
import { useEventKey } from "@/lib/idempotency";
import { useNow } from "@/lib/use-now";

const DAY_LABEL: Record<AvailabilityDay, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
  SUNDAY: "Sun",
};
const DAY_NAME: Record<AvailabilityDay, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};

interface Row {
  day: AvailabilityDay;
  available: boolean;
  start: string;
  end: string;
}

/** The week on record, Monday first, all seven days whatever the server sent. */
function weekOf(data: AvailabilityResponse): Row[] {
  return AVAILABILITY_DAYS.map((day) => {
    const d = data.week.find((w) => w.day === day);
    return d ? { day, available: d.available, start: d.start, end: d.end } : { day, available: false, start: "09:00", end: "17:00" };
  });
}

/**
 * Availability: the weekly hours the office may offer work in, and days off
 * on top. Hours are a draft until saved (with undo, and a check before
 * leaving unsaved); days off are booked and removed one stretch at a time.
 */
export default function Availability() {
  const me = useMe();
  const availability = useAvailability();
  const tz = me.data?.company.timezone;

  if (availability.data && tz) return <Editor data={availability.data} timeZone={tz} refetch={() => availability.refetch()} refreshing={availability.isRefetching} />;
  return (
    <Page header={<BackHeader title="Availability" />}>
      {availability.isError ? (
        <LoadError error={availability.error} onRetry={() => availability.refetch()} />
      ) : (
        <Loading label="Loading your availability" />
      )}
    </Page>
  );
}

function Editor({
  data,
  timeZone,
  refetch,
  refreshing,
}: {
  data: AvailabilityResponse;
  timeZone: string;
  refetch: () => void;
  refreshing: boolean;
}) {
  const now = useNow(60_000);
  const today = localDateKey(now.toISOString(), timeZone);
  const saved = weekOf(data);
  const [draft, setDraft] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<AvailabilityDay | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const setWeek = useSetWeek();
  const removeDaysOff = useRemoveDaysOff();
  const key = useEventKey();
  const navigation = useNavigation();

  const rows = draft ?? saved;
  const dirty = draft != null && JSON.stringify(draft) !== JSON.stringify(saved);
  const invalid = rows.filter((r) => r.available && toMinutes(r.end) <= toMinutes(r.start));

  // Leaving with unsaved hours asks first: a day's changes are easy to lose.
  useEffect(() => {
    if (!dirty) return;
    return navigation.addListener("beforeRemove", (e) => {
      e.preventDefault();
      Alert.alert("Discard your changes?", "Your new hours haven't been saved.", [
        { text: "Keep editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
  }, [dirty, navigation]);

  function edit(day: AvailabilityDay, patch: Partial<Row>) {
    setMessage(null);
    setError(null);
    setDraft(rows.map((r) => (r.day === day ? { ...r, ...patch } : r)));
  }

  function save() {
    if (!dirty || invalid.length > 0 || setWeek.isPending) return;
    setError(null);
    const body = { days: rows.map((r) => ({ day: r.day, available: r.available, start: r.start, end: r.end })) };
    setWeek.mutate(
      { ...body, clientEventId: key.for(body) },
      {
        onSuccess: () => {
          key.done();
          setDraft(null);
          setOpen(null);
          setMessage("Saved. The office will only offer you work in these hours.");
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        },
        onError: (e) => setError(errorText(e)),
      },
    );
  }

  async function remove(from: string, to: string) {
    const label = rangeLabel(from, to);
    const ok = await confirm({
      title: `Remove ${label}?`,
      message: "You'll be back on your usual week for these days.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    removeDaysOff.mutate(
      { from, to },
      {
        onSuccess: () => setMessage(`${label} removed. You're back on your usual week.`),
        onError: (e) => setError(errorText(e)),
      },
    );
  }

  const groups = groupDaysOff(data.daysOff).filter((g) => g.to >= today);

  const footer = dirty ? (
    <>
      {invalid.length > 0 ? (
        <FormError message={`Check ${invalid.map((r) => DAY_NAME[r.day]).join(", ")}: the finish is before the start.`} />
      ) : null}
      <FormError message={error} />
      <View style={{ flexDirection: "row", gap: space[2] }}>
        <Button
          label="Undo"
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() => {
            setDraft(null);
            setOpen(null);
            setError(null);
          }}
        />
        <Button label="Save hours" style={{ flex: 2 }} disabled={invalid.length > 0} loading={setWeek.isPending} onPress={save} />
      </View>
    </>
  ) : undefined;

  return (
    <Page header={<BackHeader title="Availability" />} footer={footer} refreshing={refreshing} onRefresh={refetch}>
      <Notice tone="accent" icon="info">
        This repeats every week. The office only offers you jobs inside these hours.
      </Notice>

      {data.effectiveFrom || data.effectiveTo ? (
        <Text variant="small" color="ink2">
          {data.effectiveFrom && data.effectiveTo
            ? `These hours apply from ${keyDayMonthYear(data.effectiveFrom)} to ${keyDayMonthYear(data.effectiveTo)}.`
            : data.effectiveFrom
              ? `These hours apply from ${keyDayMonthYear(data.effectiveFrom)}.`
              : `These hours apply until ${keyDayMonthYear(data.effectiveTo!)}.`}
        </Text>
      ) : null}

      <View style={{ backgroundColor: color.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: color.line, overflow: "hidden" }}>
        {rows.map((r, i) => {
          const expanded = open === r.day && r.available;
          const bad = r.available && toMinutes(r.end) <= toMinutes(r.start);
          return (
            <Fragment key={r.day}>
              {i > 0 ? <View style={{ height: 1, backgroundColor: color.line }} /> : null}
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingLeft: space[4], paddingRight: space[3] }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${DAY_NAME[r.day]}, ${r.available ? `${show(r.start)} to ${show(r.end)}` : "not available"}`}
                  accessibilityHint={r.available ? (expanded ? "Closes the hours" : "Change the hours") : undefined}
                  accessibilityState={{ expanded, disabled: !r.available }}
                  disabled={!r.available}
                  onPress={() => setOpen(expanded ? null : r.day)}
                  style={{ flex: 1, minHeight: 56, flexDirection: "row", alignItems: "center", gap: space[3] }}
                >
                  <Text variant="eyebrow" color={r.available ? "accentText" : "ink3"} style={{ width: 40 }}>
                    {DAY_LABEL[r.day]}
                  </Text>
                  <Text variant="bodyStrong" color={bad ? "danger" : r.available ? "ink" : "ink3"} numeral style={{ flex: 1 }}>
                    {r.available ? `${show(r.start)} – ${show(r.end)}` : "Not available"}
                  </Text>
                  {r.available ? <Text variant="small" weight="semibold" color="accentText">{expanded ? "Done" : "Change"}</Text> : null}
                </Pressable>
                <Switch
                  accessibilityLabel={`Available on ${DAY_NAME[r.day]}`}
                  value={r.available}
                  onValueChange={(v) => {
                    edit(r.day, { available: v });
                    setOpen(v ? r.day : null);
                  }}
                  trackColor={{ true: color.accent, false: color.lineStrong }}
                  thumbColor={color.surface}
                  ios_backgroundColor={color.lineStrong}
                />
              </View>
              {expanded ? (
                <View style={{ paddingHorizontal: space[4], paddingBottom: space[4], gap: space[2], backgroundColor: color.accentSofter }}>
                  <View style={{ flexDirection: "row", gap: space[4], paddingTop: space[3] }}>
                    <TimeField label="Start" value={r.start} onChange={(v) => edit(r.day, { start: v })} />
                    <TimeField label="Finish" value={r.end} onChange={(v) => edit(r.day, { end: v })} />
                  </View>
                  {bad ? (
                    <Text variant="small" color="danger">
                      Finish after you start.
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </Fragment>
          );
        })}
      </View>

      {!dirty ? <FormError message={error} /> : null}

      {message ? (
        <Notice tone="ok" icon="check">
          {message}
        </Notice>
      ) : null}

      <SectionTitle>Time off</SectionTitle>
      {groups.length === 0 ? (
        <Text variant="body" color="ink2">
          No days off booked. Every day follows your week above.
        </Text>
      ) : (
        groups.map((g) => (
          <View
            key={g.from}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space[3],
              padding: space[4],
              paddingRight: space[2],
              borderRadius: radius.lg,
              backgroundColor: color.surface,
              borderWidth: 1,
              borderColor: color.line,
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">{rangeLabel(g.from, g.to)}</Text>
              <Text variant="small" color="ink2" numeral>
                {[dayCount(g.days), g.reason ?? "Not available all day"].join(" · ")}
              </Text>
            </View>
            <IconButton icon="trash" label={`Remove ${rangeLabel(g.from, g.to)}`} disabled={removeDaysOff.isPending} onPress={() => remove(g.from, g.to)} />
          </View>
        ))
      )}
      <Button label="Add days off" variant="secondary" icon="add" onPress={() => setSheet(true)} />

      <DaysOffSheet
        visible={sheet}
        today={today}
        onClose={() => setSheet(false)}
        onBooked={(label) => {
          setSheet(false);
          setMessage(`${label} booked off. The office won't offer you work then.`);
        }}
      />
    </Page>
  );
}

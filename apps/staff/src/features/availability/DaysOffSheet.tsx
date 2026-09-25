import { MAX_DAYS_OFF_SPAN } from "@bookmops/api/v1";
import {
  Button,
  ChoiceChips,
  color,
  daysBetween,
  IconButton,
  MonthGrid,
  monthTitle,
  parseDateKey,
  radius,
  space,
  Text,
} from "@bookmops/ui-native";
import * as Haptics from "expo-haptics";
import { useCallback, useMemo, useState } from "react";
import { Modal, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAddDaysOff, useJobsBetween } from "@/data/queries";
import { errorText, FormError, Notice } from "@/features/record/ui";
import { dayCount, rangeLabel } from "@/lib/dates";
import { useEventKey } from "@/lib/idempotency";

const REASONS = [
  { value: "Vacation", label: "Vacation" },
  { value: "Appointment", label: "Appointment" },
  { value: "Sick day", label: "Sick day" },
  { value: "Personal", label: "Personal" },
] as const;
type Reason = (typeof REASONS)[number]["value"];

/**
 * Booking days off: tap the first day, then the last (or confirm just the
 * one). Days off apply straight away, as on the web, and always beat the
 * weekly hours. Jobs already booked in the span are pointed out, because
 * taking the days off doesn't cancel them.
 */
export function DaysOffSheet({
  visible,
  onClose,
  onBooked,
  today,
}: {
  visible: boolean;
  onClose: () => void;
  onBooked: (label: string) => void;
  today: string;
}) {
  const insets = useSafeAreaInsets();
  const start = parseDateKey(today)!;
  const [month, setMonth] = useState({ year: start.year, month: start.month });
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [reason, setReason] = useState<Reason | null>(null);
  const [error, setError] = useState<string | null>(null);
  const add = useAddDaysOff();
  const key = useEventKey();

  const end = to ?? from;
  const span = from && end ? daysBetween(from, end) + 1 : 0;
  const tooLong = span > MAX_DAYS_OFF_SPAN;
  const jobs = useJobsBetween(from ?? today, end ?? today, !!from && !tooLong);
  const clashes = from ? (jobs.data?.length ?? 0) : 0;

  function reset() {
    setFrom(null);
    setTo(null);
    setReason(null);
    setError(null);
    setMonth({ year: start.year, month: start.month });
  }

  function close() {
    reset();
    onClose();
  }

  // Stable until the span changes, so the memoised grid redraws only then.
  const pick = useCallback(
    (day: string) => {
      setError(null);
      // First tap, or a tap before the start: begin again from here.
      if (!from || to || day < from) {
        setFrom(day);
        setTo(null);
        return;
      }
      setTo(day === from ? null : day);
    },
    [from, to],
  );
  const range = useMemo(() => (from && end ? { from, to: end } : null), [from, end]);

  function shiftMonth(dir: 1 | -1) {
    setMonth((m) => {
      const n = m.month + dir;
      return n < 1 ? { year: m.year - 1, month: 12 } : n > 12 ? { year: m.year + 1, month: 1 } : { year: m.year, month: n };
    });
  }

  function submit() {
    if (!from || !end || tooLong || add.isPending) return;
    setError(null);
    const body = { from, to: end, reason };
    add.mutate(
      { ...body, clientEventId: key.for(body) },
      {
        onSuccess: () => {
          key.done();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          onBooked(rangeLabel(from, end));
          reset();
        },
        onError: (e) => {
          key.failed(e);
          setError(errorText(e));
        },
      },
    );
  }

  const atFirstMonth = month.year === start.year && month.month === start.month;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: color.ground }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], padding: space[4] }}>
          <Text variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
            Days off
          </Text>
          <IconButton icon="close" label="Close" onPress={close} />
        </View>
        <ScrollView contentContainerStyle={{ padding: space[4], paddingTop: 0, gap: space[4] }}>
          <Text variant="body" color="ink2">
            {!from
              ? "Tap your first day off."
              : !to
                ? "Now tap your last day, or book just this one."
                : "Tap a day to start again."}
          </Text>
          <View style={{ backgroundColor: color.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: color.line, padding: space[4], gap: space[3] }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
              <Text variant="subheading" style={{ flex: 1 }} accessibilityRole="header">
                {monthTitle(month.year, month.month)}
              </Text>
              <IconButton icon="back" label="Previous month" disabled={atFirstMonth} onPress={() => shiftMonth(-1)} />
              <IconButton icon="forward" label="Next month" onPress={() => shiftMonth(1)} />
            </View>
            <MonthGrid
              year={month.year}
              month={month.month}
              today={today}
              minDate={today}
              range={range}
              onSelect={pick}
            />
          </View>

          {from && end ? (
            <View style={{ gap: space[1] }}>
              <Text variant="subheading">{rangeLabel(from, end)}</Text>
              <Text variant="small" color={tooLong ? "danger" : "ink2"} numeral>
                {tooLong ? `That's ${span} days. Book up to ${MAX_DAYS_OFF_SPAN} at a time.` : dayCount(span)}
              </Text>
            </View>
          ) : null}

          {clashes > 0 ? (
            <Notice tone="warn" icon="warning" title={`You have ${clashes} ${clashes === 1 ? "job" : "jobs"} booked then`}>
              Taking the days off doesn't cancel them. Message the office so they can reassign the work.
            </Notice>
          ) : null}

          <View style={{ gap: space[2] }}>
            <Text variant="small" weight="semibold" color="ink2">
              Reason (optional)
            </Text>
            <ChoiceChips
              label="Reason"
              options={REASONS}
              value={reason}
              onChange={(v) => setReason((r) => (r === v ? null : v))}
            />
          </View>
          <FormError message={error} />
        </ScrollView>
        <View style={{ padding: space[4], paddingBottom: insets.bottom + space[3], backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.line }}>
          <Button
            label={from && end && !tooLong ? `Take ${rangeLabel(from, end)} off` : "Pick your days"}
            disabled={!from || tooLong}
            loading={add.isPending}
            onPress={submit}
          />
        </View>
      </View>
    </Modal>
  );
}

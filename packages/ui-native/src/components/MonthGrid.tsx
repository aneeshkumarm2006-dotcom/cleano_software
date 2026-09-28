import { memo } from "react";
import { Pressable, View } from "react-native";

import { color, radius, space } from "../tokens";
import { Text } from "./Text";

// Calendar dates here are plain "YYYY-MM-DD" keys, never instants: a month grid
// is about days on a wall calendar, and doing the arithmetic in UTC keeps a
// phone's own zone (or a daylight-saving change) from shifting a day. The
// caller decides what "today" is, in the company's zone.

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-09-01" for the given year and month (1–12) and day. */
export function dateKey(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month - 1, day));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Parse a date key; null when it isn't one. */
export function parseDateKey(key: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** The date `n` days after (or before) `key`. */
export function addDays(key: string, n: number): string {
  const p = parseDateKey(key);
  if (!p) return key;
  return dateKey(p.year, p.month, p.day + n);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(key: string): number {
  const p = parseDateKey(key);
  if (!p) return 0;
  return (new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() + 6) % 7;
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  const pa = parseDateKey(a);
  const pb = parseDateKey(b);
  if (!pa || !pb) return 0;
  return Math.round((Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86_400_000);
}

/**
 * The first and last dates a month's grid shows, Monday to Sunday: what to
 * fetch so every visible day has its data.
 */
export function monthGridRange(year: number, month: number): { from: string; to: string } {
  const first = dateKey(year, month, 1);
  const last = dateKey(year, month + 1, 0);
  return { from: addDays(first, -weekdayIndex(first)), to: addDays(last, 6 - weekdayIndex(last)) };
}

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"] as const;
/** Monday first, as `weekdayIndex` counts. The one list the apps write dates from. */
export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
/** January first: `MONTH_NAMES[month - 1]`. The one list the apps write dates from. */
export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "September 2026". */
export function monthTitle(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export interface MonthGridProps {
  year: number;
  /** 1–12. */
  month: number;
  /** Today's date key, in whatever zone the caller's "today" is. */
  today?: string;
  /** One chosen day, filled with the chrome colour. */
  selected?: string | null;
  /** A chosen span of days, both ends filled and the days between washed. */
  range?: { from: string; to: string } | null;
  /** Days that have something on them, marked with a dot. */
  marked?: ReadonlySet<string>;
  /** Days before this can't be chosen. */
  minDate?: string;
  onSelect: (key: string) => void;
  /** Extra words for a day's screen-reader label: "3 jobs". */
  describe?: (key: string) => string | undefined;
}

/**
 * A month of days, Monday first, as a grid of 44pt cells. It draws and reports
 * taps; what a tap means (pick a day, pick a range) is the caller's business.
 */
export const MonthGrid = memo(function MonthGrid({
  year,
  month,
  today,
  selected,
  range,
  marked,
  minDate,
  onSelect,
  describe,
}: MonthGridProps) {
  const first = dateKey(year, month, 1);
  const lead = weekdayIndex(first);
  const count = daysBetween(first, dateKey(year, month + 1, 1));
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: count }, (_, i) => dateKey(year, month, i + 1)),
  ];
  while (cells.length % 7) cells.push(null);
  // A day is read out with its year only when it isn't this year's.
  const todayYear = today ? parseDateKey(today)?.year : undefined;
  const showYear = todayYear != null && todayYear !== year;
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <View style={{ gap: 3 }}>
      <View style={{ flexDirection: "row" }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {WEEKDAYS.map((d, i) => (
          <Text key={i} variant="eyebrow" color="ink3" align="center" style={{ flex: 1, paddingBottom: space[1] }}>
            {d}
          </Text>
        ))}
      </View>
      {weeks.map((week, w) => (
        <View key={w} style={{ flexDirection: "row", gap: 3 }}>
          {week.map((key, i) =>
            key ? (
              <Day
                key={key}
                dateKey={key}
                weekday={i}
                showYear={showYear}
                isToday={key === today}
                isSelected={key === selected || key === range?.from || key === range?.to}
                inRange={!!range && key > range.from && key < range.to}
                hasMark={!!marked?.has(key)}
                disabled={!!minDate && key < minDate}
                onSelect={onSelect}
                extra={describe?.(key)}
              />
            ) : (
              <View key={`blank-${w}-${i}`} style={{ flex: 1, height: 44 }} />
            ),
          )}
        </View>
      ))}
    </View>
  );
});

function Day({
  dateKey: key,
  weekday,
  showYear,
  isToday,
  isSelected,
  inRange,
  hasMark,
  disabled,
  onSelect,
  extra,
}: {
  dateKey: string;
  weekday: number;
  showYear: boolean;
  isToday: boolean;
  isSelected: boolean;
  inRange: boolean;
  hasMark: boolean;
  disabled: boolean;
  onSelect: (key: string) => void;
  extra?: string;
}) {
  const p = parseDateKey(key)!;
  const label = [
    `${WEEKDAY_NAMES[weekday]} ${p.day} ${MONTH_NAMES[p.month - 1]}${showYear ? ` ${p.year}` : ""}`,
    isToday ? "today" : null,
    extra ?? null,
  ]
    .filter(Boolean)
    .join(", ");
  const weekend = weekday >= 5;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: isSelected, disabled }}
      disabled={disabled}
      onPress={() => onSelect(key)}
      style={({ pressed }) => ({
        flex: 1,
        height: 44,
        borderRadius: radius.md - 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        backgroundColor: isSelected ? color.chrome : inRange ? color.accentSoft : pressed ? color.groundDeep : "transparent",
        borderWidth: isToday && !isSelected ? 1.5 : 0,
        borderColor: color.accent,
        opacity: disabled ? 0.35 : 1,
      })}
    >
      <Text
        variant="small"
        weight={isSelected || isToday ? "bold" : "semibold"}
        color={isSelected ? "onChrome" : weekend ? "ink3" : "ink"}
        numeral
      >
        {p.day}
      </Text>
      <View
        style={{
          width: 5,
          height: 5,
          borderRadius: 3,
          backgroundColor: hasMark ? (isSelected ? color.accentOnChrome : color.accent) : "transparent",
        }}
      />
    </Pressable>
  );
}

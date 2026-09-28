// Time on the clock, from the clock state. Pure: the screen passes "now".
import type { ClockStateResponse } from "@bookmops/api/v1";

const ms = (iso: string) => new Date(iso).getTime();

/** Minutes spent on breaks, counting a break still running up to `now`. */
export function breakMs(c: ClockStateResponse, now: Date): number {
  return c.breaks.reduce((sum, b) => sum + ((b.endedAt ? ms(b.endedAt) : now.getTime()) - ms(b.startedAt)), 0);
}

/** Working time so far: clocked-in time minus breaks, up to clock-out or now. */
export function workedMs(c: ClockStateResponse, now: Date): number {
  // A finished shift: the server's own total, which knows about every session.
  if (c.state === "CLOCKED_OUT" && c.workedMinutes != null) return c.workedMinutes * 60_000;
  if (!c.clockedInAt) return 0;
  const end = c.clockedOutAt ? ms(c.clockedOutAt) : now.getTime();
  return Math.max(0, end - ms(c.clockedInAt) - breakMs(c, c.clockedOutAt ? new Date(ms(c.clockedOutAt)) : now));
}

/** "1:24:16" — a running stopwatch. */
export function stopwatch(totalMs: number): string {
  const s = Math.floor(totalMs / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// When did a tap really happen?
//
// The phone's wall clock can be wrong, and a cleaner can change it. So every
// response from the server records the server's own time (its Date header)
// against `performance.now()`, a monotonic clock that only counts forward
// from app start and that no setting can move. A tap is then stamped
//
//   server time at the last response + monotonic time elapsed since,
//
// which is right even offline, and even if the phone's clock is changed. Until
// the app has heard from the server at least once since it started, there is
// no anchor, and the stamp says honestly that it came from the device clock.
// The server decides how far to trust each (API_V1.md §6).
import type { ClockEvent } from "@bookmops/api/v1";

let anchor: { serverMs: number; monoMs: number } | null = null;

/** Wire into the API client's `onServerDate`. */
export function recordServerDate(serverDate: Date): void {
  anchor = { serverMs: serverDate.getTime(), monoMs: performance.now() };
}

/** The best estimate of "now" for a tap, and where it came from. */
export function stampNow(): Pick<ClockEvent, "occurredAt" | "clock"> {
  const deviceMs = Date.now();
  if (!anchor) {
    return { occurredAt: new Date(deviceMs).toISOString(), clock: { source: "device", offsetMs: 0 } };
  }
  const estimateMs = anchor.serverMs + (performance.now() - anchor.monoMs);
  return {
    occurredAt: new Date(estimateMs).toISOString(),
    clock: { source: "synced", offsetMs: Math.round(estimateMs - deviceMs) },
  };
}

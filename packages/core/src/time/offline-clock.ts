// Which time a clock event from a phone is applied at (API_V1.md §6).
//
// A cleaner in a basement taps "Clock in" with no signal. The phone records
// the tap with its best estimate of server time and sends it when it can. The
// tap has to count, with the time it happened -- and "I was offline" must not
// become a way to backdate a shift. So the phone's time is applied only when
//
//   1. nothing disproves the claim of being offline: the PERSON (on any of
//      their sessions) made no authenticated request after the tap while
//      sitting on it, and the session sending it existed at the tap; and
//   2. the gap between the tap and its arrival is small (under five minutes),
//      which covers normal lag and short dead spots.
//
// Anything else is applied at the time the server received it, and the
// phone's time goes to the office as a correction request to approve. Nothing
// is dropped either way. The reasons use the v1 contract's words
// (OFFLINE_REASONS in packages/api/src/v1/manager-approvals.ts).
//
// Pure: every instant comes in as a parameter.

/** A gap under this is normal lag or a short dead spot, applied as claimed. */
export const OFFLINE_APPLY_AS_CLAIMED_MS = 5 * 60_000;

/**
 * Requests made this recently before an event arrived don't disprove it.
 *
 * When signal comes back, the app refreshes its screens and drains its outbox
 * at the same moment, so a request a few seconds before the event is the
 * reconnection itself, not evidence the phone sat on the tap while online.
 */
export const RECONNECT_GRACE_MS = 30_000;

/** Clock skew tolerated between the phone's estimate and the server. */
export const CLOCK_SKEW_TOLERANCE_MS = 60_000;

export type EventTimeDecision =
  | {
      /** The phone's time is applied. */
      kind: "CLAIMED";
      appliedAt: Date;
      gapMs: number;
    }
  | {
      /**
       * The server's time is applied. `review` says whether the office should
       * see the phone's time as a correction request.
       */
      kind: "RECEIVED";
      appliedAt: Date;
      gapMs: number;
      review: boolean;
      reason: "FUTURE" | "NOT_PROVEN_OFFLINE" | "GAP_OVER_LIMIT";
    };

/**
 * How far back the server keeps a person's request activity. Anything older
 * than the five-minute rule can only end in GAP_OVER_LIMIT or NOT_PROVEN_OFFLINE,
 * both reviewed, so a little over that is enough; fifteen leaves room for skew.
 */
export const ACTIVITY_RETENTION_MS = 15 * 60_000;

/** Activity is recorded to the second: each entry is the start of a second with a request in it. */
export const ACTIVITY_RESOLUTION_MS = 1_000;

export interface EventTimeInput {
  /** When the phone says the tap happened. */
  occurredAt: Date;
  /** When the server received it. */
  receivedAt: Date;
  /**
   * Every second (its start instant) in which this person made an
   * authenticated request, on any session, over the last
   * ACTIVITY_RETENTION_MS. Unordered; duplicates are fine. A second outside
   * the retained span must not be passed, and none is inferred.
   */
  activeSeconds: readonly Date[];
  /**
   * When the session sending this event was created, or null if unknown.
   * A session that began after the tap proves the phone was online (it
   * signed in) after it; unknown is treated the same way.
   */
  sessionCreatedAt: Date | null;
}

/**
 * Whether anything proves the person was online after the tap and before the
 * reconnection:
 *
 *   - a request in a second that lies wholly inside
 *     (occurredAt + 1 s, receivedAt - RECONNECT_GRACE_MS); the second's
 *     resolution is resolved in the phone's favour at both ends, so only a
 *     request that was certainly inside the window counts;
 *   - the session was created after the tap, or its creation is unknown.
 *
 * Per person, not per session: a second session on another phone, or the
 * web, is evidence too, and a single "last request" can't be erased by a
 * request made inside the grace just before the event.
 */
export function provablyOnlineAfter(input: EventTimeInput): boolean {
  const occurred = input.occurredAt.getTime();
  const lo = occurred + 1_000;
  const hi = input.receivedAt.getTime() - RECONNECT_GRACE_MS;

  if (!input.sessionCreatedAt || input.sessionCreatedAt.getTime() > occurred) return true;

  for (const s of input.activeSeconds) {
    const start = s.getTime();
    if (start >= lo && start + ACTIVITY_RESOLUTION_MS <= hi) return true;
  }
  return false;
}

/**
 * Decide which time an event is applied at. See the file header for the
 * rules; the cases, in order:
 *
 *   - claimed more than CLOCK_SKEW_TOLERANCE_MS in the future: nonsense, the
 *     server's time, nothing to review (no earlier time is being claimed);
 *   - claimed slightly in the future (skew): the server's time, no review;
 *   - online after the tap and before the reconnection (provablyOnlineAfter):
 *     disproven, the server's time, reviewed;
 *   - a gap of five minutes or more: the server's time, reviewed;
 *   - otherwise the claimed time.
 */
export function decideEventTime(input: EventTimeInput): EventTimeDecision {
  const occurred = input.occurredAt.getTime();
  const received = input.receivedAt.getTime();
  const gapMs = received - occurred;

  if (gapMs < 0) {
    return {
      kind: "RECEIVED",
      appliedAt: input.receivedAt,
      gapMs,
      review: false,
      reason: "FUTURE",
    };
  }

  if (provablyOnlineAfter(input)) {
    return {
      kind: "RECEIVED",
      appliedAt: input.receivedAt,
      gapMs,
      review: gapMs >= 1_000,
      reason: "NOT_PROVEN_OFFLINE",
    };
  }

  if (gapMs >= OFFLINE_APPLY_AS_CLAIMED_MS) {
    return {
      kind: "RECEIVED",
      appliedAt: input.receivedAt,
      gapMs,
      review: true,
      reason: "GAP_OVER_LIMIT",
    };
  }

  return { kind: "CLAIMED", appliedAt: input.occurredAt, gapMs };
}

/** The four clock events a phone sends. */
export type ClockEventKind = "CLOCK_IN" | "CLOCK_OUT" | "BREAK_START" | "BREAK_END";

const EVENT_WORDS: Record<ClockEventKind, string> = {
  CLOCK_IN: "clock-in",
  CLOCK_OUT: "clock-out",
  BREAK_START: "break start",
  BREAK_END: "break end",
};

/**
 * The reason line on a correction request the server raises for a phone
 * event. The office reads it next to the times, so it says what happened in
 * plain words. `fmt` formats an instant in the company's zone.
 */
export function offlineCorrectionReason(args: {
  kind: ClockEventKind;
  occurredAt: Date;
  receivedAt: Date;
  why: "NOT_PROVEN_OFFLINE" | "GAP_OVER_LIMIT" | "COULD_NOT_APPLY";
  detail?: string;
  fmt: (d: Date) => string;
}): string {
  const what = EVENT_WORDS[args.kind];
  const tapped = args.fmt(args.occurredAt);
  const arrived = args.fmt(args.receivedAt);
  const head =
    args.why === "COULD_NOT_APPLY"
      ? `The app sent a ${what} tapped at ${tapped} that could not be applied`
      : args.why === "NOT_PROVEN_OFFLINE"
        ? `The app sent a ${what} tapped at ${tapped}, but the phone was online after that time, so it was recorded at ${arrived} when it arrived`
        : `The app sent a ${what} tapped at ${tapped} with no signal; it arrived at ${arrived} and was recorded then`;
  return `${head}${args.detail ? ` (${args.detail})` : ""}. Approve to use the tapped time.`;
}

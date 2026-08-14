"use client";

import type { ClockOutFailure } from "@/lib/clock-out";

/**
 * The clock-out failure notice, shared by both modals (cleano_new_fixes.pdf
 * fix 6 · Stage 5.5).
 *
 * Both clock-out surfaces — the button on the job page and the one on the clock
 * screen — used to render `result.error || "Failed to clock out"` in a red box
 * and stop there. Same component now, so the specific messages the action
 * gained in 5.2 can't reach a cleaner through one path and not the other.
 *
 * Three things it does that a red box does not:
 *
 *   RETRY      when the failure is transport or timing, resubmitting the SAME
 *              payload is the fix, and the cleaner should not have to re-pick
 *              every quantity to do it. Safe because the action's writes are one
 *              transaction and its resume path finishes a committed attempt
 *              instead of repeating it.
 *   TONE       SYNC_INCOMPLETE means the shift IS saved and only the tidy-up
 *              failed. Painting that the same red as "your entry is wrong" tells
 *              a cleaner their work vanished when it did not, which is the
 *              support call this fix exists to stop.
 *   BLAME      a failure that names a product is repeated next to that product's
 *              input by `clockOutFieldNote`, because "identify the exact field or
 *              inventory item" means at the item, not only at the bottom.
 */

export type ClockOutErrorState = Pick<
  ClockOutFailure,
  "code" | "error" | "field" | "retryable"
>;

/** True when the writes landed and only the steps after them did not. */
const isSaved = (state: ClockOutErrorState) => state.code === "SYNC_INCOMPLETE";

export function ClockOutErrorNotice({
  state,
  onRetry,
  retrying = false,
}: {
  state: ClockOutErrorState;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const saved = isSaved(state);
  const palette = saved
    ? { color: "#b45309", background: "#fffbeb", border: "#fde68a" }
    : { color: "#dc2626", background: "#fef2f2", border: "#fecaca" };

  return (
    <div
      role="alert"
      style={{
        margin: "0 16px 12px",
        fontSize: 13,
        lineHeight: 1.5,
        color: palette.color,
        background: palette.background,
        border: `1px solid ${palette.border}`,
        borderRadius: 10,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        alignItems: "flex-start",
      }}
    >
      <span>
        {saved && <strong>Your shift is saved. </strong>}
        {state.error}
      </span>
      {state.retryable && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          style={{
            border: `1px solid ${palette.border}`,
            background: "#fff",
            color: palette.color,
            borderRadius: 8,
            padding: "6px 12px",
            fontSize: 12.5,
            fontWeight: 700,
            cursor: retrying ? "wait" : "pointer",
          }}
        >
          {retrying ? "Retrying…" : "Retry"}
        </button>
      )}
    </div>
  );
}

/** The failure belongs to this product — mark its control. */
export function isClockOutFieldError(
  state: ClockOutErrorState | null,
  productId: string
): boolean {
  return state?.field?.productId === productId;
}

/** Border style for the control the failure named. */
export const clockOutFieldStyle = (flagged: boolean) =>
  flagged
    ? {
        border: "1.5px solid #dc2626",
        borderRadius: 12,
        background: "rgba(220,38,38,0.03)",
      }
    : undefined;

/** The same sentence, repeated where the cleaner is about to fix it. */
export function ClockOutFieldNote({ state }: { state: ClockOutErrorState }) {
  return (
    <div style={{ fontSize: 11.5, color: "#dc2626", marginTop: 6, lineHeight: 1.4 }}>
      {state.error}
    </div>
  );
}

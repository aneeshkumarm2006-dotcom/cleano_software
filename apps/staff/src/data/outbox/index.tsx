// The outbox: every clock action goes here first, and is sent from here.
//
// A tap is written to SQLite (./store) and shown on screen at once
// (./optimistic), then sent in the order it was made. What happens next
// depends on the answer (API_V1.md §6):
//
//   success                      → removed; the server's state replaces ours
//   offline, 5xx, retryable 409  → kept; tried again later, in order
//   signed out (401), too old    → kept; paused until that is fixed
//   any other refusal            → kept as FAILED with the server's reason,
//                                  shown to the person — never dropped
//
// Nothing a cleaner taps is lost on the phone. Whether a late or unusual time
// is applied as sent is the server's call, and it turns anything it can't
// apply into a correction request rather than a silent loss.
import { ApiError } from "@bookmops/api/client";
import type { ClockStateResponse } from "@bookmops/api/v1";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";

import { clockKeys } from "../queries/clock";
import { keys } from "../queries/jobs";
import { useMe } from "../queries/jobs";
import { useSource } from "../session";
import type { DataSource } from "../source";
import { applyOptimistic } from "./optimistic";
import { type OutboxAction, type OutboxRow, outboxStore } from "./store";

const RETRY_MS = 30_000;

interface OutboxContextValue {
  /** Record an action: saved, shown, and sent when possible. */
  record: (id: string, action: OutboxAction) => void;
  /** Actions still waiting to reach the server. */
  pending: number;
  /** Actions the server refused, with its reason. */
  failed: readonly OutboxRow[];
  /** Why sending is paused, if it is. */
  paused: "signed-out" | "update-required" | null;
  /** Put failed actions back in line and try now. */
  retry: () => void;
}

const OutboxContext = createContext<OutboxContextValue | null>(null);

async function send(source: DataSource, action: OutboxAction): Promise<ClockStateResponse | null> {
  switch (action.kind) {
    case "clockIn":
      return source.clockIn(action.jobId, action.event);
    case "startBreak":
      return source.startBreak(action.jobId, action.event);
    case "endBreak":
      return source.endBreak(action.jobId, action.event);
    case "clockOut":
      return (await source.clockOut(action.jobId, action.body)).clock;
    case "checklist":
      await source.setChecklistItem(action.jobId, action.itemId, action.done, action.clientEventId);
      return null;
  }
}

export function OutboxProvider({ children }: { children: ReactNode }) {
  const source = useSource();
  const qc = useQueryClient();
  const me = useMe();
  // Until we know who is signed in, nothing is sent: rows are owned.
  const owner = me.data ? `${me.data.company.id}:${me.data.person.id}` : null;

  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [paused, setPaused] = useState<OutboxContextValue["paused"]>(null);
  const draining = useRef(false);

  const refresh = useCallback(() => {
    if (owner) setRows(outboxStore.list(owner));
  }, [owner]);

  const drain = useCallback(async () => {
    if (!owner || draining.current) return;
    draining.current = true;
    try {
      for (const row of outboxStore.list(owner)) {
        if (row.status === "failed") continue;
        try {
          const state = await send(source, row.action);
          outboxStore.remove(row.id);
          if (state) qc.setQueryData(clockKeys.clock(state.jobId), state);
          setPaused(null);
        } catch (e) {
          const err = e instanceof ApiError ? e : new ApiError("Something went wrong.", 0, "UNKNOWN", true);
          if (err.signedOut) {
            setPaused("signed-out");
            break;
          }
          if (err.updateRequired) {
            setPaused("update-required");
            break;
          }
          if (err.retryable) {
            // Offline or a passing server problem: stop here so later actions
            // don't overtake this one, and try again later.
            outboxStore.bumpAttempts(row.id);
            break;
          }
          outboxStore.markFailed(row.id, err.message);
        }
      }
    } finally {
      draining.current = false;
      refresh();
      // The server may have finished jobs, changed hours, or sent corrections.
      qc.invalidateQueries({ queryKey: keys.today });
      qc.invalidateQueries({ queryKey: ["jobs"] });
    }
  }, [owner, source, qc, refresh]);

  const record = useCallback(
    (id: string, action: OutboxAction) => {
      if (!owner) return;
      outboxStore.add(owner, id, action, Date.now());
      applyOptimistic(qc, action);
      refresh();
      void drain();
    },
    [owner, qc, refresh, drain],
  );

  const retry = useCallback(() => {
    if (!owner) return;
    for (const row of outboxStore.list(owner)) if (row.status === "failed") outboxStore.requeue(row.id);
    refresh();
    void drain();
  }, [owner, refresh, drain]);

  // Send whatever is waiting: on sign-in, when the app comes back to the
  // foreground, and every half minute while anything is pending.
  useEffect(() => {
    refresh();
    void drain();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void drain();
    });
    return () => sub.remove();
  }, [refresh, drain]);

  const pending = rows.filter((r) => r.status === "pending").length;
  useEffect(() => {
    if (pending === 0) return;
    const id = setInterval(() => void drain(), RETRY_MS);
    return () => clearInterval(id);
  }, [pending, drain]);

  const value = useMemo<OutboxContextValue>(
    () => ({ record, pending, failed: rows.filter((r) => r.status === "failed"), paused, retry }),
    [record, pending, rows, paused, retry],
  );

  return <OutboxContext.Provider value={value}>{children}</OutboxContext.Provider>;
}

export function useOutbox(): OutboxContextValue {
  const ctx = useContext(OutboxContext);
  if (!ctx) throw new Error("useOutbox outside OutboxProvider");
  return ctx;
}

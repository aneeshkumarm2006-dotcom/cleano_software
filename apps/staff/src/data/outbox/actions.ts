// The clock actions a screen calls. Each makes an event — a fresh id and the
// trusted time of the tap — and hands it to the outbox.
import type { KitReportEntry } from "@bookmops/api/v1";
import { randomUUID } from "expo-crypto";
import * as Haptics from "expo-haptics";
import { useCallback } from "react";

import { stampNow } from "../trusted-time";
import { useOutbox } from "./index";

export function useClockActions(jobId: string) {
  const { record } = useOutbox();

  const event = useCallback(() => ({ clientEventId: randomUUID(), ...stampNow() }), []);

  // A firm tap confirms the action happened, so nobody taps twice to be sure.
  const confirm = () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

  return {
    clockIn: useCallback(() => {
      const e = event();
      record(e.clientEventId, { kind: "clockIn", jobId, event: e });
      confirm();
    }, [event, record, jobId]),

    startBreak: useCallback(() => {
      const e = event();
      record(e.clientEventId, { kind: "startBreak", jobId, event: e });
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }, [event, record, jobId]),

    endBreak: useCallback(() => {
      const e = event();
      record(e.clientEventId, { kind: "endBreak", jobId, event: e });
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }, [event, record, jobId]),

    clockOut: useCallback(
      (items: KitReportEntry[]) => {
        const e = event();
        record(e.clientEventId, { kind: "clockOut", jobId, body: { ...e, report: { items } } });
        confirm();
      },
      [event, record, jobId],
    ),

    setChecklistItem: useCallback(
      (itemId: string, done: boolean) => {
        const clientEventId = randomUUID();
        record(clientEventId, { kind: "checklist", jobId, itemId, done, clientEventId });
        void Haptics.selectionAsync().catch(() => {});
      },
      [record, jobId],
    ),
  };
}

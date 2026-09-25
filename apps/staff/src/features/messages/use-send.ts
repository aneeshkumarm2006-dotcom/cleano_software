// Sending a message: optimistic, idempotent, and never silently lost.
//
//   tap Send   → saved on the phone (./pending) and shown at once as "Sending"
//   server ok  → the saved message goes into the conversation; the copy goes
//   failure    → kept, marked "Not sent", with Try again and Delete
//   Try again  → the SAME clientEventId, so the server saves it once even if
//                the first attempt did reach it and only the answer was lost
import { ApiError } from "@bookmops/api/client";
import type { SendMessageRequest } from "@bookmops/api/v1";
import { type InfiniteData, type QueryKey, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import * as Haptics from "expo-haptics";
import { useCallback } from "react";

import { pendingStore } from "./pending";

type Page<M> = { items: M[]; nextCursor: string | null };

/** In flight in this process, so a double tap on Try again sends once. */
const inFlight = new Set<string>();

export function useThreadSender<M extends { id: string }>({
  owner,
  thread,
  queryKey,
  send,
}: {
  /** company:person, or null until /me has loaded (nothing is sent before). */
  owner: string | null;
  thread: string;
  /** The conversation's infinite query, which the saved message joins. */
  queryKey: QueryKey;
  send: (req: SendMessageRequest) => Promise<M>;
}) {
  const qc = useQueryClient();

  const deliver = useCallback(
    async (id: string, body: string) => {
      if (inFlight.has(id)) return;
      inFlight.add(id);
      pendingStore.sending(id);
      try {
        const saved = await send({ body, clientEventId: id });
        qc.setQueryData<InfiniteData<Page<M>, string | null>>(queryKey, (prev) => {
          if (!prev || prev.pages.length === 0) return prev;
          if (prev.pages.some((p) => p.items.some((m) => m.id === saved.id))) return prev;
          const [first, ...rest] = prev.pages;
          return { ...prev, pages: [{ ...first!, items: [saved, ...first!.items] }, ...rest] };
        });
        pendingStore.remove([id]);
      } catch (e) {
        // A refusal the person can act on (too long, no longer in the
        // channel) is shown in the server's words; anything passing — offline,
        // a 5xx — gets the plain "not sent, try again".
        pendingStore.failed(id, e instanceof ApiError && !e.retryable ? e.message : null);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      } finally {
        inFlight.delete(id);
      }
    },
    [qc, queryKey, send],
  );

  const sendNew = useCallback(
    (text: string): boolean => {
      const body = text.trim();
      if (!body || !owner) return false;
      const id = randomUUID();
      pendingStore.add({ id, owner, thread, body, createdAt: Date.now() });
      void Haptics.selectionAsync().catch(() => {});
      void deliver(id, body);
      return true;
    },
    [owner, thread, deliver],
  );

  const retry = useCallback(
    (id: string) => {
      const p = pendingStore.get(id);
      if (p && p.owner === owner) void deliver(p.id, p.body);
    },
    [owner, deliver],
  );

  const discard = useCallback((id: string) => pendingStore.remove([id]), []);

  return { sendNew, retry, discard };
}

// Editing and deleting your own team-chat messages: optimistic, rolled back
// on failure.
//
//   tap Save / Delete → the change shows at once, as an overlay on the
//                        conversation the server sent
//   server ok          → its answer goes into the conversation; the overlay goes
//   failure            → the overlay goes, so the message is as it was, and
//                        the person is told why
//
// The overlay sits on top of the polled pages rather than in them, so a poll
// that lands while the request is in flight can't flip the message back.
import { ApiError } from "@bookmops/api/client";
import type { TeamMessage } from "@bookmops/api/v1";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import * as Haptics from "expo-haptics";
import { useCallback, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";

import { messageKeys, type TeamPages } from "@/data/queries";
import type { DataSource } from "@/data/source";

type Patch = Pick<TeamMessage, "body" | "editedAt" | "deleted">;

function why(e: unknown, fallback: string): string {
  return e instanceof ApiError && !e.retryable ? e.message : fallback;
}

export function useOwnMessageEdits(channelId: string, source: DataSource) {
  const qc = useQueryClient();
  const [overlay, setOverlay] = useState<ReadonlyMap<string, Patch>>(new Map());
  /** In flight, so a second tap on the same message waits for the first. */
  const busy = useRef(new Set<string>());
  const queryKey = useMemo(() => messageKeys.teamMessages(channelId), [channelId]);

  const put = useCallback((id: string, patch: Patch | null) => {
    setOverlay((prev) => {
      const next = new Map(prev);
      if (patch) next.set(id, patch);
      else next.delete(id);
      return next;
    });
  }, []);

  /** Write the server's answer into the loaded pages, in place. */
  const settle = useCallback(
    async (id: string, change: (m: TeamMessage) => TeamMessage) => {
      // A poll that set off before the server had the change would bring the
      // old message back; it's dropped, and the next one brings the new.
      await qc.cancelQueries({ queryKey });
      qc.setQueryData<TeamPages>(queryKey, (prev) =>
        prev ? { ...prev, pages: prev.pages.map((p) => ({ ...p, items: p.items.map((m) => (m.id === id ? change(m) : m)) })) } : prev,
      );
    },
    [qc, queryKey],
  );

  const edit = useCallback(
    async (id: string, text: string) => {
      const body = text.trim();
      if (!body || busy.current.has(id)) return;
      busy.current.add(id);
      put(id, { body, editedAt: new Date().toISOString(), deleted: false });
      try {
        const saved = await source.editTeamMessage(channelId, id, { body, clientEventId: randomUUID() });
        await settle(id, () => saved);
      } catch (e) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        Alert.alert("Your edit wasn't saved", why(e, "Check your connection and try again. The message is as it was."));
      } finally {
        put(id, null);
        busy.current.delete(id);
      }
    },
    [channelId, source, put, settle],
  );

  const remove = useCallback(
    async (id: string) => {
      if (busy.current.has(id)) return;
      busy.current.add(id);
      put(id, { body: "", editedAt: null, deleted: true });
      try {
        await source.deleteTeamMessage(channelId, id);
        await settle(id, (m) => ({ ...m, body: "", deleted: true }));
      } catch (e) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        Alert.alert("The message wasn't deleted", why(e, "Check your connection and try again."));
      } finally {
        put(id, null);
        busy.current.delete(id);
      }
    },
    [channelId, source, put, settle],
  );

  /**
   * The office removing someone else's message (TEAM_MODERATE). The same
   * overlay as a delete of one's own; only the endpoint differs.
   */
  const moderate = useCallback(
    async (id: string) => {
      if (busy.current.has(id)) return;
      busy.current.add(id);
      put(id, { body: "", editedAt: null, deleted: true });
      try {
        await source.moderateTeamMessage(channelId, id);
        await settle(id, (m) => ({ ...m, body: "", deleted: true }));
      } catch (e) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        Alert.alert("The message wasn't removed", why(e, "Check your connection and try again."));
      } finally {
        put(id, null);
        busy.current.delete(id);
      }
    },
    [channelId, source, put, settle],
  );

  /** The server's messages with any change still in flight shown on top. */
  const apply = useCallback(
    (server: readonly TeamMessage[]): readonly TeamMessage[] =>
      overlay.size === 0
        ? server
        : server.map((m) => {
            const patch = overlay.get(m.id);
            // An edit waits for the server; a delete from elsewhere still wins.
            return patch && !(m.deleted && !patch.deleted) ? { ...m, ...patch, editedAt: patch.editedAt ?? m.editedAt } : m;
          }),
    [overlay],
  );

  return { edit, remove, moderate, apply };
}

import { ApiError } from "@bookmops/api/client";
import type { Announcement, AnnouncementsResponse, ReactionKind, ReactionState } from "@bookmops/api/v1";
import { type InfiniteData, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";

import { useSource } from "../session";

export const announcementKeys = {
  list: ["announcements"] as const,
};

type Pages = InfiniteData<AnnouncementsResponse, string | null>;

function patch(prev: Pages | undefined, fn: (a: Announcement) => Announcement, unreadCount?: number): Pages | undefined {
  if (!prev) return prev;
  return {
    ...prev,
    pages: prev.pages.map((p) => ({
      ...p,
      unreadCount: unreadCount ?? p.unreadCount,
      items: p.items.map(fn),
    })),
  };
}

/** Pinned first, then newest. Also the source of the unread count on More. */
export function useAnnouncements() {
  const source = useSource();
  return useInfiniteQuery({
    queryKey: announcementKeys.list,
    queryFn: ({ pageParam }) => source.announcements(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Announcements the person has had on screen. */
export function useMarkAnnouncementsRead() {
  const source = useSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => source.markAnnouncementsRead({ ids }),
    onSuccess: (res, ids) => {
      const marked = new Set(ids);
      qc.setQueryData<Pages>(announcementKeys.list, (prev) =>
        patch(prev, (a) => (marked.has(a.id) ? { ...a, readByMe: true, myReadStale: false } : a), res.unreadCount),
      );
    },
  });
}

/** What the counts become if this person's reaction changes to `next`. */
function applyReaction(state: ReactionState, next: ReactionKind | null): ReactionState {
  const counts = new Map(state.reactions.map((r) => [r.kind, r.count]));
  if (state.myReaction) counts.set(state.myReaction, Math.max(0, (counts.get(state.myReaction) ?? 0) - 1));
  if (next) counts.set(next, (counts.get(next) ?? 0) + 1);
  return {
    reactions: [...counts].filter(([, n]) => n > 0).map(([kind, count]) => ({ kind, count })),
    myReaction: next,
  };
}

/**
 * Set (not toggle) this person's reaction, shown at once. The id is made at
 * the tap, so the automatic retry of a dropped request is the same request,
 * and setting is harmless to repeat anyway.
 */
export function useSetReaction() {
  const source = useSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; kind: ReactionKind | null; clientEventId: string }) =>
      source.setAnnouncementReaction(v.id, { kind: v.kind, clientEventId: v.clientEventId }),
    retry: (failures, error) => failures < 2 && error instanceof ApiError && error.retryable,
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: announcementKeys.list });
      const before = qc.getQueryData<Pages>(announcementKeys.list);
      qc.setQueryData<Pages>(announcementKeys.list, (prev) =>
        patch(prev, (a) => (a.id === v.id ? { ...a, ...applyReaction(a, v.kind) } : a)),
      );
      return { before };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(announcementKeys.list, ctx.before);
    },
    onSuccess: (state, v) => {
      qc.setQueryData<Pages>(announcementKeys.list, (prev) => patch(prev, (a) => (a.id === v.id ? { ...a, ...state } : a)));
    },
  });
}

/** A fresh event id for a reaction tap. */
export const newReactionEventId = () => randomUUID();

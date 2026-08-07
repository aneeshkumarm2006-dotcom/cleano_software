"use client";

import useSWR from "swr";
import {
  getAdminAttentionCounts,
  type AdminAttentionCounts,
} from "@/app/admin/actions/getAdminAttentionCounts";

const ZERO: AdminAttentionCounts = {
  requests: 0,
  applications: 0,
  quotes: 0,
  documents: 0,
  leads: 0,
  payouts: 0,
  inventory: 0,
};

/**
 * Every sidebar attention count, from one request (awerfixes.pdf item 11).
 *
 * One SWR key for the whole set, so seven badges cost one request per poll —
 * the same "share the key, not the query" reasoning as `useJobChatUnread`.
 *
 * 30s, not the 5s the badges it replaces used. These are ops queues, not a
 * conversation: an application or a pay period that arrived 20 seconds ago does
 * not need to interrupt anyone, and the old cadence meant two independent
 * requests every five seconds for the whole time an admin had a tab open. The
 * staff-chat poll deliberately keeps its 5s beat in `Sidebar.tsx` because it
 * also drives the "new message" toast, which genuinely is time-sensitive.
 */
export function useAdminAttentionCounts(): AdminAttentionCounts {
  const { data } = useSWR<AdminAttentionCounts>(
    ["admin-attention-counts"],
    () => getAdminAttentionCounts(),
    {
      refreshInterval: 30_000,
      revalidateOnFocus: true,
      keepPreviousData: true,
    }
  );
  return data ?? ZERO;
}

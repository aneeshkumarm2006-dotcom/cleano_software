"use client";

import useSWR from "swr";
import type { AdminAttentionCounts } from "@/app/admin/actions/getAdminAttentionCounts";

const ZERO: AdminAttentionCounts = {
  requests: 0,
  applications: 0,
  quotes: 0,
  documents: 0,
  leads: 0,
  payouts: 0,
  inventory: 0,
};

async function fetchAttentionCounts(): Promise<AdminAttentionCounts> {
  const res = await fetch("/api/admin/attention-counts", {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`attention counts ${res.status}`);
  return (await res.json()) as AdminAttentionCounts;
}

/**
 * Every sidebar attention count, from one request (awerfixes.pdf item 11).
 *
 * One SWR key for the whole set, so seven badges cost one request per poll —
 * the same "share the key, not the query" reasoning as `useJobChatUnread`.
 *
 * Plain GET, not the server action it used to call. An action's response
 * carries an RSC re-render of whatever route the caller is on, and this hook
 * lives in the sidebar, i.e. on every admin page — so the badges were
 * periodically restarting the render of the page they decorate. See
 * src/lib/chatUnread.ts for the measurements.
 *
 * 60s, up from 30s. These are ops queues, not a conversation: an application or
 * a pay period that arrived 45 seconds ago does not need to interrupt anyone,
 * and each poll is seven counts against a database with 1.7-3.5 s round trips.
 * `refreshWhenHidden: false` is SWR's default and is stated explicitly because
 * it is load-bearing: a backgrounded tab must stop paying for this.
 */
export function useAdminAttentionCounts(): AdminAttentionCounts {
  const { data } = useSWR<AdminAttentionCounts>(
    ["admin-attention-counts"],
    fetchAttentionCounts,
    {
      refreshInterval: 60_000,
      refreshWhenHidden: false,
      revalidateOnFocus: true,
      keepPreviousData: true,
    }
  );
  return data ?? ZERO;
}

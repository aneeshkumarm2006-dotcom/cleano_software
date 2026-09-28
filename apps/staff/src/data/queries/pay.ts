import { ApiError } from "@bookmops/api/client";
import type { WithdrawalRequest } from "@bookmops/api/v1";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSource } from "../session";

export const payKeys = {
  all: ["pay"] as const,
  summary: ["pay", "summary"] as const,
  payouts: ["pay", "payouts"] as const,
  withdrawals: ["pay", "withdrawals"] as const,
  period: (id: string) => ["pay", "period", id] as const,
  job: (jobId: string) => ["pay", "job", jobId] as const,
};

export function usePay() {
  const source = useSource();
  return useQuery({ queryKey: payKeys.summary, queryFn: () => source.pay() });
}

/**
 * Past payouts and withdrawals are history: they change on payday or when the
 * cleaner asks for money (which refreshes everything under "pay"), so a few
 * minutes between refetches is plenty. Refetching pages every visit is not.
 */
const HISTORY_STALE_MS = 5 * 60_000;

export function usePayouts() {
  const source = useSource();
  return useInfiniteQuery({
    queryKey: payKeys.payouts,
    queryFn: ({ pageParam }) => source.payouts(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: HISTORY_STALE_MS,
  });
}

export function useWithdrawals() {
  const source = useSource();
  return useInfiniteQuery({
    queryKey: payKeys.withdrawals,
    queryFn: ({ pageParam }) => source.withdrawals(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: HISTORY_STALE_MS,
  });
}

export function usePayPeriod(id: string) {
  const source = useSource();
  return useQuery({ queryKey: payKeys.period(id), queryFn: () => source.payPeriod(id) });
}

export function useJobPay(jobId: string) {
  const source = useSource();
  return useQuery({ queryKey: payKeys.job(jobId), queryFn: () => source.jobPay(jobId) });
}

/**
 * Ask for a withdrawal. The caller supplies the `clientEventId`, made when the
 * person confirmed and kept for as long as the outcome is unknown, so a retry
 * after a dropped connection can never become a second withdrawal.
 */
export function useRequestWithdrawal() {
  const source = useSource();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: WithdrawalRequest) => source.requestWithdrawal(body),
    retry: (failures, error) => failures < 2 && error instanceof ApiError && error.retryable,
    onSettled: () => {
      // The balance and the list changed, or the balance we showed was stale.
      void queryClient.invalidateQueries({ queryKey: payKeys.all });
    },
  });
}

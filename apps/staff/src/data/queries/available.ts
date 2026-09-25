import { ApiError } from "@bookmops/api/client";
import type { AvailableWhen } from "@bookmops/api/v1";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useRef } from "react";

import { useSource } from "../session";
import { keys } from "./jobs";

export const availableKeys = {
  all: ["available"] as const,
  list: (when: AvailableWhen) => ["available", "list", when] as const,
  job: (id: string) => ["available", "job", id] as const,
};

/** The board, a page at a time. Kept fresh: other cleaners are claiming too. */
export function useAvailableJobs(when: AvailableWhen) {
  const source = useSource();
  return useInfiniteQuery({
    queryKey: availableKeys.list(when),
    queryFn: ({ pageParam }) => source.availableJobs(when, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 15_000,
  });
}

export function useAvailableJob(id: string) {
  const source = useSource();
  return useQuery({ queryKey: availableKeys.job(id), queryFn: () => source.availableJob(id), staleTime: 15_000 });
}

/**
 * Claim a job. One idempotency key per job for as long as the outcome is
 * unknown: a retry after a dropped connection re-sends the SAME key, so if the
 * first request did land the server answers with that result instead of a
 * second claim. The key is dropped once the server has given a definite answer.
 */
export function useClaimJob() {
  const source = useSource();
  const queryClient = useQueryClient();
  const attempts = useRef(new Map<string, string>());

  return useMutation({
    mutationFn: (jobId: string) => {
      let key = attempts.current.get(jobId);
      if (!key) {
        key = randomUUID();
        attempts.current.set(jobId, key);
      }
      return source.claimJob(jobId, key);
    },
    // The same key goes with every retry, so retrying is safe.
    retry: (failures, error) => failures < 2 && error instanceof ApiError && error.retryable,
    onSuccess: (_data, jobId) => {
      attempts.current.delete(jobId);
      queryClient.removeQueries({ queryKey: availableKeys.job(jobId) });
    },
    onError: (error, jobId) => {
      if (!(error instanceof ApiError) || !error.retryable) attempts.current.delete(jobId);
    },
    onSettled: () => {
      // Won or lost, the board has changed; a win also lands in Today and My jobs.
      void queryClient.invalidateQueries({ queryKey: availableKeys.all });
      void queryClient.invalidateQueries({ queryKey: keys.today });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

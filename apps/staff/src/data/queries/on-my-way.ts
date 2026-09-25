import type { OnMyWayRequest, OnMyWayState } from "@bookmops/api/v1";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSource } from "../session";

export const onMyWayKeys = {
  state: (jobId: string) => ["on-my-way", jobId] as const,
};

/** Whether this cleaner has said they're on their way, and if location is wanted. */
export function useOnMyWayState(jobId: string, enabled = true) {
  const source = useSource();
  return useQuery({ queryKey: onMyWayKeys.state(jobId), queryFn: () => source.onMyWayState(jobId), enabled });
}

/** Tell the office (and the client) you're on your way. Not queued offline: late news is wrong news. */
export function useMarkOnMyWay(jobId: string) {
  const source = useSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OnMyWayRequest) => source.markOnMyWay(jobId, body),
    onSuccess: (res) => {
      qc.setQueryData<OnMyWayState>(onMyWayKeys.state(jobId), (prev) => ({
        sentAt: res.sentAt,
        askForLocation: prev?.askForLocation ?? false,
      }));
    },
  });
}

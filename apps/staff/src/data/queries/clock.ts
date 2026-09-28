import { useQuery } from "@tanstack/react-query";

import { useSource } from "../session";

export const clockKeys = {
  clock: (jobId: string) => ["clock", jobId] as const,
  checklist: (jobId: string) => ["checklist", jobId] as const,
  kitReport: (jobId: string) => ["kit-report", jobId] as const,
};

export function useClockState(jobId: string) {
  const source = useSource();
  return useQuery({ queryKey: clockKeys.clock(jobId), queryFn: () => source.clockState(jobId) });
}

export function useChecklist(jobId: string) {
  const source = useSource();
  return useQuery({ queryKey: clockKeys.checklist(jobId), queryFn: () => source.checklist(jobId) });
}

export function useKitReport(jobId: string) {
  const source = useSource();
  return useQuery({ queryKey: clockKeys.kitReport(jobId), queryFn: () => source.kitReport(jobId) });
}

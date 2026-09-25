import type { JobScope } from "@bookmops/api/v1";
import { useQuery } from "@tanstack/react-query";

import { useSource } from "./session";

// One place for query keys, so invalidating after a mutation (clock in, claim)
// names the same keys the screens read.
export const keys = {
  me: ["me"] as const,
  today: ["today"] as const,
  jobs: (scope: JobScope) => ["jobs", scope] as const,
  job: (id: string) => ["job", id] as const,
};

export function useMe() {
  const source = useSource();
  return useQuery({ queryKey: keys.me, queryFn: () => source.me(), staleTime: 5 * 60_000 });
}

export function useToday() {
  const source = useSource();
  return useQuery({ queryKey: keys.today, queryFn: () => source.today() });
}

export function useJobs(scope: JobScope) {
  const source = useSource();
  return useQuery({ queryKey: keys.jobs(scope), queryFn: () => source.jobs(scope) });
}

export function useJob(id: string) {
  const source = useSource();
  return useQuery({ queryKey: keys.job(id), queryFn: () => source.job(id) });
}

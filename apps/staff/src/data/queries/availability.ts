import type { AvailabilityResponse, DaysOffRequest, WeekUpdateRequest } from "@bookmops/api/v1";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSource } from "../session";

export const availabilityKeys = {
  availability: ["availability"] as const,
};

export function useAvailability() {
  const source = useSource();
  return useQuery({ queryKey: availabilityKeys.availability, queryFn: () => source.availability() });
}

/** Every availability write answers with the whole availability: it replaces what's loaded. */
function useAvailabilityWrite<V>(write: (vars: V) => Promise<AvailabilityResponse>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: (data) => qc.setQueryData(availabilityKeys.availability, data),
  });
}

export function useSetWeek() {
  const source = useSource();
  return useAvailabilityWrite((body: WeekUpdateRequest) => source.setWeek(body));
}

export function useAddDaysOff() {
  const source = useSource();
  return useAvailabilityWrite((body: DaysOffRequest) => source.addDaysOff(body));
}

export function useRemoveDaysOff() {
  const source = useSource();
  return useAvailabilityWrite(({ from, to }: { from: string; to: string }) => source.removeDaysOff(from, to));
}

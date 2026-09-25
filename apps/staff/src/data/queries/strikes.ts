import { useQuery } from "@tanstack/react-query";

import { useSource } from "../session";

export const strikeKeys = {
  strikes: ["strikes"] as const,
};

export function useStrikes() {
  const source = useSource();
  return useQuery({ queryKey: strikeKeys.strikes, queryFn: () => source.strikes() });
}

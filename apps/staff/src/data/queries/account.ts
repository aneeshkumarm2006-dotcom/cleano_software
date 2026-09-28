// The person's own account: asking the company to delete it.
import type { DeletionRequestBody } from "@bookmops/api/v1";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSource } from "../session";

export const accountKeys = {
  deletionRequest: ["account", "deletion-request"] as const,
};

export function useDeletionRequest() {
  const source = useSource();
  return useQuery({ queryKey: accountKeys.deletionRequest, queryFn: () => source.deletionRequest() });
}

/** Ask the company to delete the account. Nothing is deleted by the app. */
export function useRequestDeletion() {
  const source = useSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DeletionRequestBody) => source.requestDeletion(body),
    onSuccess: ({ requestedAt }) => qc.setQueryData(accountKeys.deletionRequest, { pending: true, requestedAt }),
  });
}

import type { SignDocumentRequest } from "@bookmops/api/v1";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useSource } from "../session";

export const documentKeys = {
  list: ["documents"] as const,
  document: (id: string) => ["documents", id] as const,
};

export function useDocuments() {
  const source = useSource();
  return useQuery({ queryKey: documentKeys.list, queryFn: () => source.documents() });
}

export function useDocument(id: string) {
  const source = useSource();
  return useQuery({ queryKey: documentKeys.document(id), queryFn: () => source.document(id) });
}

/**
 * Record an open or a download. Best effort, as on the web: never awaited by
 * a screen, never retried, and a failure is not the cleaner's problem.
 */
export function useLogDocumentAccess(id: string) {
  const source = useSource();
  return useCallback(
    (action: "OPEN" | "DOWNLOAD") => {
      source.logDocumentAccess(id, { action }).catch(() => {});
    },
    [source, id],
  );
}

export function useSignDocument(id: string) {
  const source = useSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SignDocumentRequest) => source.signDocument(id, body),
    onSuccess: (doc) => {
      qc.setQueryData(documentKeys.document(id), doc);
      void qc.invalidateQueries({ queryKey: documentKeys.list, exact: true });
    },
  });
}

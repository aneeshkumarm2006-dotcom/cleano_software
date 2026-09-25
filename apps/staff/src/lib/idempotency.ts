import { randomUUID } from "expo-crypto";
import { useMemo, useRef } from "react";

/**
 * The idempotency key for a form's submission (API_V1.md §6).
 *
 * A key is made the first time a given body is sent and REUSED if that same
 * body is sent again — a retry after a timeout — so the server applies it
 * once. Change the body and it is a new request with a new key (reusing a key
 * with a different body is refused with 422). After a success, `done()` lets
 * the next submission start fresh.
 */
export function useEventKey() {
  const last = useRef<{ body: string; key: string } | null>(null);
  return useMemo(
    () => ({
      for(body: unknown): string {
        const s = JSON.stringify(body);
        if (last.current?.body === s) return last.current.key;
        const key = randomUUID();
        last.current = { body: s, key };
        return key;
      },
      done() {
        last.current = null;
      },
    }),
    [],
  );
}


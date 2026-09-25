// The request fingerprint an idempotency key is bound to (API_V1.md §6).
// Pure, so the tests can compute the same hash the server stores.
import { createHash } from "node:crypto";

/** JSON with object keys sorted, so the same body always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/**
 * SHA-256 of the method, the concrete path with its ids filled in, and the
 * canonical body (API_V1.md §6). Ids live in the path, so a hash of the body
 * alone would let one reused key replay one job's answer as another's.
 */
export function requestHash(method: string, path: string, body: unknown): string {
  return createHash("sha256")
    .update(`${method.toUpperCase()}\n${path}\n${canonicalJson(body)}`)
    .digest("hex");
}

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

/** sha256 of the route, the path parameters and the canonical body. */
export function requestHash(route: string, params: unknown, body: unknown): string {
  return createHash("sha256").update(`${route}\n${canonicalJson(params)}\n${canonicalJson(body)}`).digest("hex");
}

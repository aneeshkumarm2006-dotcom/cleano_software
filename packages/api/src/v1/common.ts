// Shared building blocks of the v1 contract.
//
// Rules this file exists to enforce (docs/architecture/API_V1.md §3):
//   - responses are parsed leniently: unknown fields are ignored, never
//     rejected, so the server can add a field without breaking an old build;
//   - enums in RESPONSES are open: a value this build has never heard of is
//     kept and marked unknown instead of failing the whole response;
//   - money is integer cents; instants are ISO 8601 with their offset.
import { z } from "zod";

/** Integer cents. Never a float: 0.1 + 0.2 is not a price. */
export const Cents = z.number().int();

/** An instant, with its offset: "2026-09-25T13:30:00.000Z". */
export const Instant = z.iso.datetime({ offset: true });

/** A calendar date in the company's own zone: "2026-09-25". */
export const LocalDate = z.iso.date();

/** The value an open enum takes when the server sends something newer. */
export const UNKNOWN = "UNKNOWN" as const;

/**
 * An enum for response data that tolerates values added after this build.
 * Known values come through as themselves; anything else becomes UNKNOWN, and
 * the app shows a neutral fallback for it rather than failing to parse.
 */
export function openEnum<const T extends readonly [string, ...string[]]>(values: T) {
  const known = new Set<string>(values);
  return z.string().transform((v): T[number] | typeof UNKNOWN => (known.has(v) ? (v as T[number]) : UNKNOWN));
}

/** Every error the API returns has this shape. */
export const ErrorBody = z.object({
  error: z.object({
    /** Stable: the app branches on it. Treat codes it doesn't know by HTTP status. */
    code: z.string(),
    /** Written for the person holding the phone. */
    message: z.string(),
    /** Whether the offline queue should try again. */
    retryable: z.boolean(),
  }),
  requestId: z.string().optional(),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

/** A page of a list, with an opaque cursor for the next one. */
export function page<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

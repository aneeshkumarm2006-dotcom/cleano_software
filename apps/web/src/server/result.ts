// What a service gives back: a value, or a failure the caller can explain.
//
// `code` is stable and maps to an HTTP status in the v1 wrapper. `message` is
// the sentence the web action already showed, kept word for word so moving
// the logic into a service changes nothing a person sees.
import "server-only";

import type { Effect } from "./effects";

export type FailureStatus = 400 | 403 | 404 | 409 | 422 | 429;

export interface Failure {
  ok: false;
  code: string;
  message: string;
  status: FailureStatus;
  retryable?: boolean;
}

export interface Success<T> {
  ok: true;
  value: T;
  effects: Effect[];
}

export type Result<T> = Success<T> | Failure;

export const ok = <T>(value: T, effects: Effect[] = []): Success<T> => ({ ok: true, value, effects });

export const failure = (
  status: FailureStatus,
  code: string,
  message: string,
  retryable = false,
): Failure => ({ ok: false, code, message, status, retryable });

/** Not found and not yours are the same answer, so ids can't be probed. */
export const notFound = (message = "This isn't available.") => failure(404, "NOT_FOUND", message);

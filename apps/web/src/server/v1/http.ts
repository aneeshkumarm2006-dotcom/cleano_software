// The v1 error envelope and response helpers (API_V1.md §3, "Errors").
//
//   { "error": { "code", "message", "retryable" }, "requestId" }
//
// `message` is written for the person holding the phone. Details stay in the
// server logs, keyed by the request id.
import "server-only";

export class V1Error extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "V1Error";
  }
}

/** Headers every v1 response carries. Authenticated answers are never cached. */
export function baseHeaders(requestId: string): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Request-Id": requestId,
  };
}

export function jsonResponse(
  status: number,
  body: unknown,
  requestId: string,
  extra: Record<string, string> = {},
): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { ...baseHeaders(requestId), ...extra },
  });
}

export function errorBody(code: string, message: string, retryable: boolean, requestId: string) {
  return { error: { code, message, retryable }, requestId };
}

export function errorResponse(err: V1Error, requestId: string): Response {
  return jsonResponse(
    err.status,
    errorBody(err.code, err.message, err.retryable, requestId),
    requestId,
    err.headers,
  );
}

// The common refusals, worded once.
export const E = {
  badRequest: (message = "Something in that request wasn't right.", code = "VALIDATION_FAILED") =>
    new V1Error(400, code, message),
  unauthenticated: () => new V1Error(401, "UNAUTHENTICATED", "Your session has ended. Sign in again."),
  forbidden: (code: string, message: string) => new V1Error(403, code, message),
  notFound: (message = "This isn't available.") => new V1Error(404, "NOT_FOUND", message),
  rateLimited: (retryAfterSeconds: number) =>
    new V1Error(429, "RATE_LIMITED", "Too many requests. Wait a moment and try again.", true, {
      "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))),
    }),
  updateRequired: () =>
    new V1Error(426, "UPDATE_REQUIRED", "This version of the app is too old. Please update it to carry on."),
  internal: () => new V1Error(500, "INTERNAL", "Something went wrong on our side. Try again in a moment.", true),
};

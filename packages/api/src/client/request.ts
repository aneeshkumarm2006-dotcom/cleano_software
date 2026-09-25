// The core of the v1 client: options, the error type, and the request function
// every endpoint shares. Endpoints live beside this file, one per area.
import type { z } from "zod";

import { ErrorBody } from "../v1/common";

export interface ClientOptions {
  /** The company's own address, from sign-in discovery: "https://acme.useawer.com". */
  baseUrl: string;
  /** The native build and OTA update, e.g. "1.0.0 (42)". Old builds are told to update. */
  appVersion: string;
  platform: "ios" | "android";
  /** The session cookie, from the auth client's secure storage. */
  getCookie: () => string | null | undefined | Promise<string | null | undefined>;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  /**
   * Called with the server's own time on every response (its Date header).
   * The app anchors offline clock events to it, so a phone whose clock is
   * wrong — or has been changed — still records when a tap really happened.
   */
  onServerDate?: (serverDate: Date) => void;
}

/** Anything a v1 call can fail with, network failures included. */
export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status; 0 when the request never reached the server. */
    readonly status: number,
    /** The server's stable code, or NETWORK / BAD_RESPONSE / UNEXPECTED_REDIRECT from the client. */
    readonly code: string,
    readonly retryable: boolean,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** The session is gone: send the person to sign in, and keep any queued work. */
  get signedOut(): boolean {
    return this.status === 401;
  }

  /** This build is too old for the server. */
  get updateRequired(): boolean {
    return this.status === 426;
  }
}

/** A v1 call: the path, the schema its response must match, and fetch options. */
export type Request = <S extends z.ZodType>(path: string, schema: S, init?: RequestInit) => Promise<z.infer<S>>;

/**
 * Build the one function every endpoint goes through. It adds the headers
 * every v1 call carries, sends the session as an explicit header, checks the
 * response against the contract, and turns every failure into an ApiError.
 */
export function makeRequest(options: ClientOptions): Request {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/+$/, "");

  return async function request<S extends z.ZodType>(path: string, schema: S, init: RequestInit = {}): Promise<z.infer<S>> {
    const cookie = await options.getCookie();
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        ...init,
        // The session travels as an explicit header; the platform's own cookie
        // jar is not used, so nothing is sent that the app didn't choose.
        credentials: "omit",
        // The session is an explicit header, and some platforms keep custom
        // headers across a redirect to another host. v1 never redirects, so
        // one is refused rather than followed.
        redirect: "error",
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          "X-App-Version": options.appVersion,
          "X-App-Platform": options.platform,
          ...(cookie ? { Cookie: cookie } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new ApiError("You're offline. We'll try again when you're back.", 0, "NETWORK", true);
    }

    // Where `redirect` isn't honoured, a response from anywhere but the
    // company's own origin is still never trusted.
    if (res.url && originOf(res.url) !== originOf(base)) {
      throw new ApiError("Something went wrong. Try again.", res.status, "UNEXPECTED_REDIRECT", false);
    }

    const serverDate = res.headers.get("date");
    if (serverDate && options.onServerDate) {
      const d = new Date(serverDate);
      if (!Number.isNaN(d.getTime())) options.onServerDate(d);
    }

    const text = await res.text();
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      // Not JSON: a proxy error page, a timeout. Handled below.
    }

    if (!res.ok) {
      const parsed = ErrorBody.safeParse(json);
      if (parsed.success) {
        const e = parsed.data;
        throw new ApiError(e.error.message, res.status, e.error.code, e.error.retryable, e.requestId);
      }
      throw new ApiError("Something went wrong. Try again in a moment.", res.status, "HTTP_" + res.status, res.status >= 500);
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      // The server sent something this build can't read. Say so plainly
      // rather than crashing a screen later on a missing field.
      throw new ApiError("This screen couldn't load. Please update the app.", res.status, "BAD_RESPONSE", false);
    }
    return parsed.data;
  };
}

/** Encode a path segment taken from data (an id), never trusted as-is. */
export const seg = (value: string) => encodeURIComponent(value);

/**
 * A JSON request. A mutation the app may retry (clock in, claim, withdraw)
 * passes an idempotency key generated when the person tapped, so a retry is
 * applied once however many times it is sent (API_V1.md §6).
 */
export const json = (
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
  idempotencyKey?: string,
): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
  headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
});

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

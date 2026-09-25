// The typed client the mobile apps use to call /api/v1.
//
// It knows nothing about screens or state. It adds the headers every v1 call
// carries, checks every response against the contract, and turns every failure
// into one error type the app can branch on.
import type { z } from "zod";

import { ErrorBody } from "./v1/common";
import { JobDetailResponse, JobsListResponse, type JobScope, TodayResponse } from "./v1/jobs";
import { MeResponse } from "./v1/me";

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
}

/** Anything a v1 call can fail with, network failures included. */
export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status; 0 when the request never reached the server. */
    readonly status: number,
    /** The server's stable code, or NETWORK / BAD_RESPONSE from the client. */
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

export function createClient(options: ClientOptions) {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/+$/, "");

  async function request<S extends z.ZodType>(path: string, schema: S, init: RequestInit = {}): Promise<z.infer<S>> {
    const cookie = await options.getCookie();
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        ...init,
        // The session travels as an explicit header; the platform's own cookie
        // jar is not used, so nothing is sent that the app didn't choose.
        credentials: "omit",
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
  }

  return {
    me: () => request("/api/v1/me", MeResponse),
    today: () => request("/api/v1/today", TodayResponse),
    jobs: (scope: JobScope, cursor?: string | null) =>
      request(
        `/api/v1/jobs?scope=${encodeURIComponent(scope)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        JobsListResponse,
      ),
    job: (id: string) => request(`/api/v1/jobs/${encodeURIComponent(id)}`, JobDetailResponse),
  };
}

export type ApiClient = ReturnType<typeof createClient>;

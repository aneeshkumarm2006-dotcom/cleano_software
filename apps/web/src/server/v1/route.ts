// v1Route: the one wrapper every /api/v1 endpoint is built with, so no
// endpoint can forget a check (API_V1.md §4).
//
//   export const POST = v1Route(
//     { host: "tenant", access: "staff", body: ClockEvent, idempotent: true },
//     (ctx) => clockInForPhone(ctx.actor, …),
//   );
//
// The gates, in order:
//    1. request id, on every response
//    2. IP rate limit, before anything touches the database
//    3. CSRF on every non-GET: JSON content type + X-App-Platform (together
//       they force a CORS preflight, which fails because v1 allows no
//       cross-origin callers); an Origin that isn't the request's own, or
//       Sec-Fetch-Site cross-site / same-site, is refused. Every company
//       subdomain is "same-site" to every other, so a SameSite=Lax cookie
//       would otherwise still ride a POST from a sibling workspace.
//    4. app version: 426 below the minimum
//    5. host class: a tenant route on the apex, www or a preview host is 404;
//       a platform route never reads a tenant
//    6. company from the host; missing or not active is 403 WORKSPACE_SUSPENDED
//    7. everything after runs inside runAsOrg(company)
//    8. session: 401 without one; the person's company must equal the host's,
//       checked explicitly
//    9. account state, read fresh: ACCOUNT_INACTIVE; PASSWORD_CHANGE_REQUIRED
//       except where a route allows it (/me, /me/password)
//   10. role: an allow-list; missing or unknown is 403
//   11. per-person rate limit
//   12. validation of query and body: 400
//   13. idempotency (./idempotency)
//   14. the handler; a Failure becomes the envelope, CrossTenantError is 404,
//       anything unexpected is 500 with the request id and no details
//   15. effects, flushed with after() once the response has gone
//
// Ownership ("is this cleaner on this job?") is not a gate: it depends on the
// data, so it lives in the service, and not-yours answers 404 like not-found.
import "server-only";

import { after } from "next/server";
import type { z } from "zod";

import { db as rawDb } from "@/db";
import { auth } from "@/lib/auth";
import { CrossTenantError } from "@/lib/db-scoped";
import { db } from "@/lib/org-db";
import { runAsOrg, type OrgContext } from "@/lib/org-context";
import { rateLimitHit } from "@/lib/rate-limit";
import { sharedLimitHit } from "@/lib/shared-rate-limit";
import { orgSlugFromHost, PLATFORM_ORG_SLUG, publicHostFromHeaders } from "@/lib/tenant";

import type { Actor } from "../actor";
import { roleAllowed, type Access } from "./access";
import { flushEffects, type Effect } from "../effects";
import type { Failure, Result } from "../result";
import { E, errorBody, errorResponse, jsonResponse, V1Error } from "./http";
import { recordActivity } from "./activity";
import { claimKey, completeKey, isValidKey, releaseKey, requestHash } from "./idempotency";
import { readJsonBody } from "./body";
import { verifiedSessionToken } from "./session-token";
import { appVersions, isBelow, parseVersion } from "./versions";

// ── Policy ──────────────────────────────────────────────────────────────────

/**
 * A cheap limit per address, before the database. Set with carrier NAT in
 * mind: a whole crew on one mobile address at shift start must not lock each
 * other out. Per instance, in memory (see lib/rate-limit.ts); the endpoints
 * where spreading across instances matters add `shared: true` to their limit.
 */
const IP_LIMIT = { max: 600, windowMs: 60_000 };
const USER_LIMIT = { max: 240, windowMs: 60_000 };

const MAX_BODY_BYTES = 64 * 1024;
const MAX_BODY_BYTES_CEILING = 512 * 1024;

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * A limit by name. `shared: true` adds a second layer counted in Postgres
 * across every instance (lib/shared-rate-limit.ts) behind the in-memory one,
 * for the endpoints where `limit x instances` matters.
 */
export interface NamedLimit {
  name: string;
  max: number;
  windowMs: number;
  shared?: boolean;
}

export interface RouteOptions<B extends z.ZodType | undefined, Q extends z.ZodType | undefined> {
  /** tenant: a company's own address. platform: the front door; never reads a tenant. */
  host: "tenant" | "platform";
  access: Access;
  body?: B;
  query?: Q;
  /** Checked against the handler's answer in development and tests. */
  response?: z.ZodType;
  /** Requires an Idempotency-Key header; a retry is applied once. */
  idempotent?: boolean;
  /** /me and /me/password answer even while a password change is pending. */
  allowPendingPasswordChange?: boolean;
  /** Skips the app-version gate. Only GET /meta, which is how the app learns it. */
  skipVersionGate?: boolean;
  /**
   * An extra per-person limit for an endpoint that costs something (API_V1.md
   * §4). Counted after idempotency, so a replayed key isn't counted again.
   */
  limit?: NamedLimit;
  /** An extra per-address limit for a platform endpoint, by name. */
  ipLimit?: NamedLimit;
  /**
   * A larger body cap than the default 64 KB, for the one kind of request that
   * needs it (a drawn signature's strokes). Never above MAX_BODY_BYTES_CEILING.
   */
  maxBodyBytes?: number;
  /**
   * For an idempotent route whose answer shouldn't sit in IdempotencyRecord
   * for 30 days (signed document links, money): store only `ref(answer)` --
   * ids and status, nothing else -- and on a replay rebuild the answer with
   * `reread`, from current data, firing no effects. Errors are stored as
   * usual (a code and a message).
   */
  replay?: ReplayOptions;
}

/** What a replay-by-reference route stores: ids and status only. */
export type ReplayRef = Record<string, string | number | boolean | null>;

export interface ReplayOptions {
  ref: (answer: never) => ReplayRef;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the route's own context; checked where it is declared
  reread: (ctx: AuthedContext<any, any>, ref: ReplayRef) => Promise<HandlerResult<unknown>>;
}

const REPLAY_REF = "$replayRef";

function storedRef(body: unknown): ReplayRef | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const ref = (body as Record<string, unknown>)[REPLAY_REF];
  return ref && typeof ref === "object" && !Array.isArray(ref) ? (ref as ReplayRef) : null;
}

type Infer<T> = T extends z.ZodType ? z.output<T> : undefined;

export interface BaseContext<B, Q> {
  requestId: string;
  req: Request;
  params: Record<string, string>;
  query: Q;
  body: B;
  /** When the server received this request. Services take their "now" from here. */
  receivedAt: Date;
  ip: string;
  appVersion: string | null;
  platform: string | null;
}

export interface TenantContext<B, Q> extends BaseContext<B, Q> {
  org: OrgContext;
}

export interface AuthedContext<B, Q> extends TenantContext<B, Q> {
  actor: Actor;
  session: {
    id: string;
    token: string;
    /** When the session was created (signed in). The offline clock rule reads it (API_V1.md §6). */
    createdAt: Date;
  };
  idempotencyKey: string | null;
}

export type ContextFor<A extends Access, H extends "tenant" | "platform", B, Q> = A extends "public"
  ? H extends "tenant"
    ? TenantContext<B, Q>
    : BaseContext<B, Q>
  : AuthedContext<B, Q>;

/** What a handler returns: a service Result, or a plain body. */
export type HandlerResult<T> =
  | Result<T>
  | { ok: true; value: T; effects?: Effect[]; status?: number };

type NextContext = { params: Promise<Record<string, string | string[] | undefined>> };

// ── Helpers ─────────────────────────────────────────────────────────────────

export function clientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

/** The origin the request was sent to, as the browser would write it. */
function ownOrigin(headers: Headers): string | null {
  const host = publicHostFromHeaders(headers);
  if (!host) return null;
  const hostname = host.split(":")[0];
  const local = hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1";
  const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || (local ? "http" : "https");
  return `${proto}://${host}`.toLowerCase();
}

/**
 * The company this host names, or null when it names none. A host "names" a
 * company only when its first label IS that company's slug: the apex, www,
 * preview deployments and bare IPs resolve to a default workspace in
 * orgSlugFromHost, and a tenant route must never be served from one of those.
 */
function tenantSlugOf(headers: Headers): string | null {
  const host = publicHostFromHeaders(headers);
  if (!host) return null;
  const hostname = host.split(":")[0].trim().toLowerCase().replace(/\.$/, "");
  const slug = orgSlugFromHost(host);
  if (!slug || slug === PLATFORM_ORG_SLUG) return null;
  return hostname.startsWith(`${slug}.`) ? slug : null;
}

function checkCsrf(req: Request): void {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return;

  const contentType = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new V1Error(415, "UNSUPPORTED_MEDIA_TYPE", "Requests must be sent as JSON.");
  }
  const platform = req.headers.get("x-app-platform");
  if (platform !== "ios" && platform !== "android") {
    throw E.forbidden("CSRF_REJECTED", "This request wasn't sent by the app.");
  }
  const origin = req.headers.get("origin");
  if (origin && origin.toLowerCase() !== ownOrigin(req.headers)) {
    throw E.forbidden("CSRF_REJECTED", "This request wasn't sent by the app.");
  }
  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") {
    throw E.forbidden("CSRF_REJECTED", "This request wasn't sent by the app.");
  }
}

function checkVersion(req: Request, host: "tenant" | "platform"): void {
  const parsed = parseVersion(req.headers.get("x-app-version"));
  if (!parsed) throw E.badRequest("Missing or unreadable app version.", "APP_VERSION_REQUIRED");
  const versions = appVersions();
  // A platform endpoint serves both apps and can't tell them apart, so it
  // holds only the lower of the two minimums. Company endpoints are Bookmops
  // Pro's for now.
  const min =
    host === "platform"
      ? [versions.pro.minSupportedVersion, versions.customer.minSupportedVersion]
          .map((v) => parseVersion(v)!)
          .reduce((a, b) => (isBelow(a, b) ? a : b))
      : parseVersion(versions.pro.minSupportedVersion)!;
  if (isBelow(parsed, min)) throw E.updateRequired();
}

function limitOrThrow(name: string, key: string, opts: { max: number; windowMs: number }): void {
  if (rateLimitHit(name, key, opts)) throw E.rateLimited(opts.windowMs / 1000);
}

/** The in-memory limit, then (for `shared`) the one every instance counts. */
async function namedLimitOrThrow(name: string, key: string, opts: NamedLimit): Promise<void> {
  limitOrThrow(name, key, opts);
  if (opts.shared) await sharedLimitOrThrow(name, key, opts);
}

/**
 * The shared layer. Fails closed: a store that can't be reached refuses the
 * request as retryable, rather than letting an unmetered one through.
 */
export async function sharedLimitOrThrow(name: string, key: string, opts: { max: number; windowMs: number }): Promise<void> {
  let over: boolean;
  try {
    over = await sharedLimitHit(name, key, opts);
  } catch (e) {
    console.error(JSON.stringify({ at: "v1.shared-limit", name, error: String(e).slice(0, 200) }));
    throw E.internal();
  }
  if (over) throw E.rateLimited(opts.windowMs / 1000);
}

function queryObject(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of url.searchParams) {
    // A repeated parameter is ambiguous; the first one wins, and the schema
    // decides whether it is allowed at all.
    if (!(k in out)) out[k] = v;
  }
  return out;
}

function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown, requestId: string, what: string): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    console.warn(
      JSON.stringify({
        at: "v1.validation",
        requestId,
        what,
        issues: r.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })),
      }),
    );
    throw E.badRequest();
  }
  return r.data;
}

/** A service Failure, as the envelope's error. */
export function failureToError(f: Failure): V1Error {
  return new V1Error(f.status, f.code, f.message, f.retryable ?? false);
}

const validateResponses =
  process.env.NODE_ENV !== "production" || process.env.V1_VALIDATE_RESPONSES === "1";

// ── The wrapper ─────────────────────────────────────────────────────────────

export function v1Route<
  A extends Access,
  H extends "tenant" | "platform",
  B extends z.ZodType | undefined = undefined,
  Q extends z.ZodType | undefined = undefined,
  T = unknown,
>(
  options: RouteOptions<B, Q> & { access: A; host: H },
  handler: (ctx: ContextFor<A, H, Infer<B>, Infer<Q>>) => Promise<HandlerResult<T>>,
) {
  if (options.host === "platform" && options.access !== "public") {
    throw new Error("v1Route: a platform route has no tenant, so it cannot have a session.");
  }

  return async function v1Handler(req: Request, next?: NextContext): Promise<Response> {
    // 1. Request id.
    const requestId = crypto.randomUUID();
    const started = Date.now();
    const receivedAt = new Date();
    const url = new URL(req.url);
    const routeName = `${req.method.toUpperCase()} ${url.pathname}`;
    const ip = clientIp(req.headers);
    const log: Record<string, unknown> = {
      at: "v1",
      requestId,
      route: routeName,
      // Client-set headers: bounded, so a log line can't be made arbitrarily long.
      appVersion: req.headers.get("x-app-version")?.slice(0, 40) ?? null,
      platform: req.headers.get("x-app-platform")?.slice(0, 16) ?? null,
    };
    const finish = (res: Response, code?: string) => {
      log.status = res.status;
      if (code) log.code = code;
      log.ms = Date.now() - started;
      console.log(JSON.stringify(log));
      return res;
    };

    try {
      // 2. IP limit.
      limitOrThrow("v1:ip", ip, IP_LIMIT);
      if (options.ipLimit) await namedLimitOrThrow(`v1:${options.ipLimit.name}:ip`, ip, options.ipLimit);

      // 3. CSRF.
      checkCsrf(req);

      // 4. App version.
      if (!options.skipVersionGate) checkVersion(req, options.host);

      const rawParams = next ? await next.params : {};
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawParams ?? {})) {
        if (typeof v === "string") params[k] = v;
      }

      const base: BaseContext<unknown, unknown> = {
        requestId,
        req,
        params,
        query: undefined,
        body: undefined,
        receivedAt,
        ip,
        appVersion: req.headers.get("x-app-version"),
        platform: req.headers.get("x-app-platform"),
      };

      // 12 (for platform routes, which have no session). Validation.
      const validate = async () => {
        base.query = options.query
          ? parseOrThrow(options.query, queryObject(url), requestId, "query")
          : undefined;
        const method = req.method.toUpperCase();
        if (options.body) {
          const cap = Math.min(options.maxBodyBytes ?? MAX_BODY_BYTES, MAX_BODY_BYTES_CEILING);
          base.body = parseOrThrow(options.body, await readJsonBody(req, cap), requestId, "body");
        } else if (method !== "GET" && method !== "HEAD") {
          // No body expected: one that is sent anyway is still read and bounded.
          await readJsonBody(req, MAX_BODY_BYTES);
        }
      };

      // 5. Host class.
      if (options.host === "platform") {
        await validate();
        const result = await handler(base as ContextFor<A, H, Infer<B>, Infer<Q>>);
        return finish(await respond(result, requestId, null, null, options.response));
      }

      const slug = tenantSlugOf(req.headers);
      if (!slug) throw E.notFound();

      // 6. Company.
      const orgRow = await rawDb.organization.findUnique({
        where: { slug },
        select: { id: true, slug: true, name: true, timezone: true, status: true },
      });
      if (!orgRow || orgRow.status !== "ACTIVE") {
        throw E.forbidden("WORKSPACE_SUSPENDED", "This company's workspace is on hold. Contact your office.");
      }
      const org: OrgContext = { id: orgRow.id, slug: orgRow.slug, name: orgRow.name, timezone: orgRow.timezone };
      log.org = org.slug;

      // 7. Everything else as this company.
      return await runAsOrg(org, async () => {
        if (options.access === "public") {
          await validate();
          const tenant: TenantContext<unknown, unknown> = { ...base, org };
          const result = await handler(tenant as ContextFor<A, H, Infer<B>, Infer<Q>>);
          return finish(await respond(result, requestId, org, null, options.response));
        }

        // 8. Session.
        const session = await auth.api.getSession({ headers: req.headers });
        if (!session?.user?.id || !session.session?.token) {
          throw await whyNoSession(req, org);
        }

        // 9. Account state, fresh — and the explicit company match. The read
        // is scoped to this company, so another company's person is simply
        // not found; the organizationId comparison says so out loud.
        const person = await db.user.findUnique({
          where: { id: session.user.id },
          select: {
            id: true,
            organizationId: true,
            role: true,
            name: true,
            email: true,
            isActive: true,
            deletedAt: true,
            mustChangePassword: true,
          },
        });
        if (!person || person.organizationId !== org.id) throw E.unauthenticated();
        log.user = person.id;
        // Any authenticated request is evidence of being online (API_V1.md
        // §6), whatever it goes on to answer. Written after the response.
        const personId = person.id;
        after(() => runAsOrg(org, () => recordActivity(org.id, personId, receivedAt)));
        if (!person.isActive || person.deletedAt) {
          throw E.forbidden("ACCOUNT_INACTIVE", "This account has been switched off. Contact your office.");
        }
        if (person.mustChangePassword && !options.allowPendingPasswordChange) {
          throw E.forbidden("PASSWORD_CHANGE_REQUIRED", "Choose a new password to carry on.");
        }

        // 10. Role.
        const access = options.access as Exclude<Access, "public">;
        const role = person.role as string | null;
        if (!role || !roleAllowed(access, role)) {
          throw typeof access === "object"
            ? E.forbidden("FORBIDDEN", "Your role can't do this.")
            : E.forbidden("ROLE_NOT_ALLOWED", "This app isn't for your account. Use the web app instead.");
        }

        // 11. Per-person limit.
        limitOrThrow("v1:user", `${org.id}:${person.id}`, USER_LIMIT);

        // 12. Validation.
        await validate();

        const sessionRow = await db.session.findUnique({
          where: { token: session.session.token },
          select: { id: true, createdAt: true },
        });
        if (!sessionRow) throw E.unauthenticated();

        const actor: Actor = {
          userId: person.id,
          organizationId: org.id,
          role,
          name: person.name,
          email: person.email,
        };

        // Built after validation, so it carries the parsed body and query.
        const ctx: AuthedContext<unknown, unknown> = {
          ...base,
          org,
          actor,
          session: { id: sessionRow.id, token: session.session.token, createdAt: sessionRow.createdAt },
          idempotencyKey: null,
        };

        // 13. Idempotency.
        let idempotencyKey: string | null = null;
        let recordId: string | null = null;
        if (options.idempotent) {
          const key = req.headers.get("idempotency-key");
          if (!isValidKey(key)) {
            throw E.badRequest("This request needs an Idempotency-Key.", "IDEMPOTENCY_KEY_REQUIRED");
          }
          const bodyEventId = (base.body as { clientEventId?: unknown } | undefined)?.clientEventId;
          if (typeof bodyEventId === "string" && bodyEventId !== key) {
            throw E.badRequest("The Idempotency-Key must be the event's clientEventId.", "IDEMPOTENCY_KEY_MISMATCH");
          }
          idempotencyKey = key;
          ctx.idempotencyKey = key;
          const claim = await claimKey({
            userId: person.id,
            key,
            route: routeName,
            hash: requestHash(req.method, url.pathname, base.body),
            now: receivedAt,
          });
          if (claim.kind === "replay") {
            log.replay = true;
            const ref = options.replay && claim.statusCode < 400 ? storedRef(claim.body) : null;
            if (ref && options.replay) {
              // Rebuilt from current data; nothing stored again, no effects.
              const again = await options.replay.reread(ctx, ref);
              if (!again.ok) return finish(errorResponse(failureToError(again), requestId));
              checkContract(again.value, requestId, options.response);
              return finish(
                jsonResponse(claim.statusCode, again.value, requestId, { "Idempotent-Replayed": "true" }),
              );
            }
            return finish(
              jsonResponse(claim.statusCode, claim.body, requestId, { "Idempotent-Replayed": "true" }),
            );
          }
          recordId = claim.recordId;
        }

        // Endpoint-specific limit, after idempotency: a replay isn't counted.
        try {
          if (options.limit) await namedLimitOrThrow(`v1:${options.limit.name}`, `${org.id}:${person.id}`, options.limit);
        } catch (e) {
          if (recordId) await releaseKey(recordId);
          throw e;
        }

        // 14. The handler.
        let res: Response;
        try {
          const result = await handler(ctx as ContextFor<A, H, Infer<B>, Infer<Q>>);
          res = await respond(result, requestId, org, recordId, options.response, options.replay);
        } catch (e) {
          if (recordId) {
            // A refusal the handler meant is final and stored; anything else
            // frees the key so the retry can succeed.
            if (e instanceof V1Error && !e.retryable && e.status < 500) {
              await completeKey(recordId, e.status, errorBody(e.code, e.message, false, requestId)).catch(() => {});
            } else if (e instanceof CrossTenantError) {
              await completeKey(recordId, 404, errorBody("NOT_FOUND", E.notFound().message, false, requestId)).catch(
                () => {},
              );
            } else {
              await releaseKey(recordId).catch(() => {});
            }
          }
          throw e;
        }

        return finish(res);
      });
    } catch (e) {
      if (e instanceof V1Error) return finish(errorResponse(e, requestId), e.code);
      if (e instanceof CrossTenantError) return finish(errorResponse(E.notFound(), requestId), "NOT_FOUND");
      console.error(JSON.stringify({ at: "v1.error", requestId, route: routeName }), e);
      return finish(errorResponse(E.internal(), requestId), "INTERNAL");
    }
  };
}

/** The answer against its contract, in development and tests (validateResponses). */
function checkContract(value: unknown, requestId: string, responseSchema: z.ZodType | undefined): void {
  if (!responseSchema || !validateResponses) return;
  const check = responseSchema.safeParse(value);
  if (check.success) return;
  console.error(
    JSON.stringify({
      at: "v1.contract",
      requestId,
      issues: check.error.issues.map((i) => ({ path: i.path.join("."), code: i.code, message: i.message })),
    }),
  );
  throw new V1Error(500, "CONTRACT_VIOLATION", "Something went wrong on our side. Try again in a moment.", true);
}

/**
 * Turn a handler's result into the response, store it against the idempotency
 * key, and schedule its effects.
 */
async function respond<T>(
  result: HandlerResult<T>,
  requestId: string,
  org: OrgContext | null,
  recordId: string | null,
  responseSchema: z.ZodType | undefined,
  replay?: ReplayOptions,
): Promise<Response> {
  if (!result.ok) {
    const err = failureToError(result);
    if (recordId) {
      if (err.retryable) await releaseKey(recordId);
      else await completeKey(recordId, err.status, errorBody(err.code, err.message, false, requestId));
    }
    return errorResponse(err, requestId);
  }

  const status = ("status" in result && result.status) || 200;
  try {
    checkContract(result.value, requestId, responseSchema);
  } catch (e) {
    if (recordId) await releaseKey(recordId);
    throw e;
  }

  if (recordId) {
    await completeKey(
      recordId,
      status,
      replay ? { [REPLAY_REF]: replay.ref(result.value as never) } : result.value,
    );
  }

  const effects = result.effects ?? [];
  if (effects.length > 0) after(() => flushEffects(org, effects));
  return jsonResponse(status, result.value, requestId);
}

/** 403 ACCOUNT_INACTIVE when the cookie belongs to a switched-off person here; otherwise 401. */
async function whyNoSession(req: Request, org: OrgContext): Promise<V1Error> {
  try {
    const token = verifiedSessionToken(req.headers.get("cookie"), process.env.BETTER_AUTH_SECRET);
    if (!token) return E.unauthenticated();
    const row = await db.session.findUnique({
      where: { token },
      select: { userId: true, expiresAt: true },
    });
    if (!row || row.expiresAt.getTime() <= Date.now()) return E.unauthenticated();
    const person = await db.user.findUnique({
      where: { id: row.userId },
      select: { organizationId: true, isActive: true, deletedAt: true },
    });
    if (person && person.organizationId === org.id && (!person.isActive || person.deletedAt)) {
      return E.forbidden("ACCOUNT_INACTIVE", "This account has been switched off. Contact your office.");
    }
  } catch (e) {
    console.error("v1 session diagnosis", e);
  }
  return E.unauthenticated();
}

/**
 * An id from the path. Ids are cuids; anything else can't be one of ours, so
 * it is the same 404 as an id that doesn't exist.
 */
export function pathId(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw E.notFound();
  return value;
}

/** Clock events: generous for a real shift, far below a flood. */
export const CLOCK_EVENT_LIMIT = { name: "clock", max: 60, windowMs: 60_000 };

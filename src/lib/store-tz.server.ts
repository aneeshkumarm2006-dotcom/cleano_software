// Which tenant's clock an ordinary browser request runs on.
//
// This is the half of Sept 10 item 6 that `org-context.ts` could not cover.
// Cron jobs and scripts announce their organization outright, so a resolver
// can simply read the announcement. A browser request announces nothing: it
// carries a HOST, the host has to be turned into an organization record, and
// that is a database round-trip. Every timezone helper is synchronous, so
// there is nothing for them to await.
//
// THE WAY OUT is that the round-trip has already happened. `getCurrentOrg()`
// is wrapped in React's per-request cache and is called by the root layout on
// every gated request, and again by `requireOrgId()` before any query runs.
// Nothing in this app formats a date it has not first fetched. So the lookup
// is not repeated here — the organization is remembered the moment it is
// resolved, and the synchronous helpers read what is already known.
//
// WHY React's `cache()` AND NOT A MODULE VARIABLE. A module variable is shared
// by every request the server is handling at that moment, so two tenants
// loading a page at the same time would take each other's clock — and it would
// happen under load, intermittently, which is the worst way for a bug like
// this to appear. `cache()` gives one holder per request and no more.
//
// WHY NOT AsyncLocalStorage, which the announcement path uses. A layout cannot
// wrap the render of its children in a call frame: Next hands the layout the
// page as an already-built element and React renders it after the layout
// returns, outside the layout's stack. There is no frame to run the rest of
// the request inside, so there is nothing for AsyncLocalStorage to attach to.
import "server-only";

import { cache } from "react";

import { orgFromContext } from "@/lib/org-context";
import { __setStoreTzResolver } from "@/lib/timezone";

/**
 * One mutable holder per request.
 *
 * `cache()` is normally used to memoise a lookup; here the memoised value is a
 * box to put an answer in. Same guarantee either way — identical object within
 * one request, a fresh one for the next.
 */
const requestTzHolder = cache((): { tz?: string } => ({}));

/**
 * Remember the zone this request's organization runs on.
 *
 * Called from `getCurrentOrg()`, which is the one place the organization is
 * turned into a record. Silent when there is no answer to give and silent
 * outside a request, because both mean "nothing to remember", not "something
 * went wrong": the deployment default is still there to fall back on.
 */
export function rememberRequestTz(tz: string | null | undefined): void {
  if (!tz) return;
  try {
    requestTzHolder().tz = tz;
  } catch {
    // No request cache at all — a script, or build-time prerendering.
  }
}

/** The zone remembered for this request, if one has been resolved yet. */
export function currentRequestTz(): string | undefined {
  try {
    return requestTzHolder().tz;
  } catch {
    return undefined;
  }
}

/**
 * The zone to stamp on the page for the browser half.
 *
 * An explicit announcement still wins, for the same reason it wins on the
 * server: a platform admin working on another workspace is looking at that
 * workspace's times, and the two halves of one page must never disagree.
 */
export function pageStoreTz(): string | undefined {
  return orgFromContext()?.timezone ?? currentRequestTz();
}

// Asked SECOND, after the announcement. See the order in lib/timezone.ts.
__setStoreTzResolver("request", currentRequestTz);

import { AsyncLocalStorage } from "node:async_hooks";

// Deliberately not marked "server-only". Operational scripts are one of the
// main callers -- they have no request either, and they need to announce which
// organization they are working on exactly the way cron does. node:async_hooks
// already makes this unusable in a browser.

/**
 * Which organization the code currently running belongs to, when there is no
 * request to ask.
 *
 * Inside a request the answer comes from the host, and nothing needs this. But
 * cron jobs, webhooks and scripts have no host: they iterate over every
 * organization in turn, and every piece of work they do — the queries, the links
 * in the emails they send — has to belong to whichever one they are on.
 *
 * Passing the organization down through every function that might eventually
 * send an email is not realistic; there are hundreds. So it rides alongside the
 * call instead, the same way the tenant connection does.
 */

export interface OrgContext {
  id: string;
  slug: string;
  name: string;
  timezone: string;
}

const storage = new AsyncLocalStorage<OrgContext>();

/**
 * Run `fn` as this organization.
 *
 * Everything awaited inside — however deep — sees it. Nesting replaces rather
 * than merges, so a loop over organizations cannot leak the previous one into
 * the next.
 */
export function runAsOrg<T>(org: OrgContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(org, fn);
}

/** The organization set by runAsOrg, or undefined inside a normal request. */
export function orgFromContext(): OrgContext | undefined {
  return storage.getStore();
}

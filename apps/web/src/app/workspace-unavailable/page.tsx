import OrgUnavailable from "@/components/OrgUnavailable";

/**
 * Shown when the workspace behind this subdomain cannot be used.
 *
 * A page of its own rather than something the root layout renders in place.
 * Returning early from a layout hides the page visually but does not stop it
 * rendering: Next renders children in parallel, so the page's data still went
 * out in the response. A suspended workspace was serving its whole client list
 * -- names, emails, phone numbers -- inside a screen that said "on hold".
 * Redirecting means nothing downstream runs at all.
 */
export default async function WorkspaceUnavailablePage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; name?: string }>;
}) {
  const { reason, name } = await searchParams;
  const valid = ["suspended", "cancelled", "pending", "not-found"] as const;
  const r = (valid as readonly string[]).includes(reason ?? "")
    ? (reason as (typeof valid)[number])
    : "not-found";
  return <OrgUnavailable reason={r} name={name} />;
}

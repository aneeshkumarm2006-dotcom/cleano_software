/*
 * Not marked "server-only", matching org.ts and org-url.ts beside it: that
 * marker is aliased away by Next and is not a real package, so importing it
 * puts this module out of reach of the verification scripts. The next/headers
 * import in the org lookup already stops a client component using this.
 */
import { getCurrentOrg } from "@/lib/org";
import { orgFromContext } from "@/lib/org-context";
import { orgFolderFor } from "@/lib/asset-paths";

/**
 * Where one company's uploads live.
 *
 * Every upload used to land under a shared `cleano/` root — one folder tree for
 * the whole platform, named after the first customer. Two problems with that,
 * and only one of them is tidiness.
 *
 * The tidy one: offboarding a company, or answering "what has this customer
 * stored", means picking their assets out of everybody else's by inspecting ids.
 *
 * The real one: `isBookingPhotoUrl` accepts a photo if it sits in the booking
 * folder on our cloud. With ONE booking folder for everybody, a booking taken by
 * company A could attach a photo of company B's customer's home — a genuine,
 * fetchable URL that passed every check. Giving each company its own folder is
 * what makes that test mean something.
 *
 * Keyed on the SLUG rather than the id, because a human reads these: support
 * looking at the Cloudinary console should see `awer/teamcleano/jobs/...`, not
 * a cuid. Slugs are immutable in this codebase — nothing anywhere updates one —
 * and that is now load-bearing: adding a rename would strand every existing
 * path, so a rename feature has to move or alias the folders with it.
 *
 * Old assets are not migrated and do not need to be. Their full URLs are stored
 * on the rows that use them and keep resolving; only new uploads take the new
 * shape.
 */

export { ASSET_ROOT, orgFolderFor, bookingPhotoFolderFor } from "@/lib/asset-paths";

/** The slug of the company this request is acting for. */
export async function currentOrgSlug(): Promise<string> {
  const ctx = orgFromContext();
  if (ctx?.slug) return ctx.slug;
  const org = await getCurrentOrg();
  if (!org) throw new Error("No workspace for this request; refusing to store a file.");
  return org.slug;
}

/**
 * A folder under the current company, e.g. `orgAssetFolder("jobs", jobId)`.
 *
 * Throws rather than falling back to a shared folder when the company cannot be
 * resolved. An upload that cannot say who it belongs to is one nobody can
 * later find, delete, or prove the ownership of.
 */
export async function orgAssetFolder(...segments: string[]): Promise<string> {
  const slug = await currentOrgSlug();
  const clean = segments
    .map((s) => String(s).replace(/[^A-Za-z0-9._-]/g, ""))
    .filter(Boolean);
  return [orgFolderFor(slug), ...clean].join("/");
}

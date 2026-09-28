// Which stored URLs may be handed to a phone, and how (API_V1.md §4, "Only
// stored URLs go out").
//
// Pure: no database, no Cloudinary client, no "server-only". The v1 services
// call it with the company's slug and the cloud name, and a verify script can
// call it with made-up ones.
//
// Two kinds of URL pass:
//   - a file on the company's OWN storage: https://res.cloudinary.com/<our
//     cloud>/<image|video|raw>/<upload|authenticated>/[s--sig--/][v123/]
//     awer/<slug>/... . It is never sent as stored: the caller mints a
//     short-lived signed URL from the parsed parts (see signCompanyFile in
//     ./company-file-sign);
//   - for training videos only, a public video page on youtube.com, youtu.be
//     or vimeo.com (or a subdomain), https, with no credentials or odd port.
// Anything else the office typed in is not passed on.
import { orgFolderFor } from "@/lib/asset-paths";

const MAX_URL = 2048;

export interface CompanyFile {
  resourceType: "image" | "video" | "raw";
  deliveryType: "upload" | "authenticated";
  /** Without the version or signature segments; for image/video, without the extension. */
  publicId: string;
  /** image/video: the extension, which Cloudinary treats as the format. */
  format: string | null;
}

const SEGMENT = /^[A-Za-z0-9._-]{1,200}$/;

/**
 * The parts of a URL on this company's own Cloudinary folder, or null when it
 * is anywhere else: another cloud, another company's folder, a transformation
 * URL, or anything that isn't plain https.
 */
export function parseCompanyFileUrl(
  raw: unknown,
  opts: { cloudName: string | undefined; orgSlug: string },
): CompanyFile | null {
  if (typeof raw !== "string" || !opts.cloudName || !opts.orgSlug) return null;
  const s = raw.trim();
  if (!s || s.length > MAX_URL) return null;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com") return null;
  if (url.username || url.password || url.port || url.search || url.hash) return null;

  const parts = url.pathname.split("/").slice(1);
  if (parts.some((p) => !SEGMENT.test(p) || p === "." || p === "..")) return null;
  const [cloud, resourceType, deliveryType, ...rest] = parts;
  if (cloud !== opts.cloudName) return null;
  if (resourceType !== "image" && resourceType !== "video" && resourceType !== "raw") return null;
  if (deliveryType !== "upload" && deliveryType !== "authenticated") return null;

  // Only a signature and a version may come before the public id. Anything
  // else there is a transformation, which this never re-issues.
  let i = 0;
  if (rest[i] && /^s--[A-Za-z0-9_-]{8,32}--$/.test(rest[i]!)) i++;
  if (rest[i] && /^v\d{1,12}$/.test(rest[i]!)) i++;
  const idParts = rest.slice(i);
  const folder = orgFolderFor(opts.orgSlug).split("/");
  if (idParts.length <= folder.length) return null;
  if (folder.some((f, k) => idParts[k] !== f)) return null;

  let publicId = idParts.join("/");
  let format: string | null = null;
  if (resourceType !== "raw") {
    const last = idParts[idParts.length - 1]!;
    const dot = last.lastIndexOf(".");
    if (dot > 0) {
      format = last.slice(dot + 1).toLowerCase();
      if (!/^[a-z0-9]{1,8}$/.test(format)) return null;
      publicId = publicId.slice(0, publicId.length - (last.length - dot));
    }
  }
  return { resourceType, deliveryType, publicId, format };
}

const VIDEO_HOSTS = ["youtube.com", "youtu.be", "vimeo.com"];

/**
 * A public video page the app may open with the phone's own player: https on
 * youtube.com, youtu.be or vimeo.com, or a subdomain of one. Returns the
 * normalised URL, or null.
 */
export function publicVideoUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > MAX_URL) return null;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!VIDEO_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return null;
  return url.toString();
}

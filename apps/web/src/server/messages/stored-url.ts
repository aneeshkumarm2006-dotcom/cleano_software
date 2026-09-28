// Only stored URLs go out (API_V1.md §4). An office-chat attachment's URL was
// sent in by a web client and stored as-is, so before one is passed on it must
// be https on our own Cloudinary cloud, in the folder the chat uploader puts
// THAT SENDER's files in:
//
//   awer/<company slug>/chat/<senderId>/...   (uploadChatAttachment today)
//   cleano/chat/<senderId>/...                (before per-company folders,
//                                              c08e8ae, 2026-08-28)
//
// matched from the start of the path, as Cloudinary delivers an upload:
//   /<cloud>/(image|raw)/upload/(v<version>/)?<folder>/chat/<senderId>/<file>
//
// Anything else is left out, never forwarded. Tying the folder to the sender
// means a URL can't point at another company's files, or at another person's.
import "server-only";

import { orgFolderFor } from "@/lib/asset-paths";

export function isSendersChatAsset(
  url: unknown,
  orgSlug: string,
  senderId: string,
  cloudName = process.env.CLOUDINARY_CLOUD_NAME,
): boolean {
  if (typeof url !== "string" || !cloudName || !orgSlug || !senderId || url.length > 2048) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "res.cloudinary.com") return false;
  if (parsed.username || parsed.password || parsed.port) return false;
  // URL() has already resolved any "..", so this is the path Cloudinary serves.
  // Anchored from the cloud name to the sender's folder, so the folder can't
  // appear somewhere else in the path (a transformation, a nested folder, a
  // public id that merely contains "/chat/<senderId>/").
  const path = parsed.pathname;
  const cloud = escapeRegExp(cloudName);
  const sender = escapeRegExp(senderId);
  const folders = [orgFolderFor(orgSlug), LEGACY_CHAT_ROOT].map(escapeRegExp).join("|");
  const re = new RegExp(`^/${cloud}/(?:image|raw)/upload/(?:v\\d+/)?(?:${folders})/chat/${sender}/[^/]`);
  return re.test(path);
}

/** Where chat uploads lived before per-company folders (c08e8ae). */
const LEGACY_CHAT_ROOT = "cleano";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Only stored URLs go out (API_V1.md §4). An office-chat attachment's URL was
// sent in by a web client and stored as-is, so before one is passed on it must
// be https on our own Cloudinary cloud, in the folder the chat uploader puts
// THAT SENDER's files in:
//
//   awer/<company slug>/chat/<senderId>/...   (uploadChatAttachment today)
//   cleano/chat/<senderId>/...                (before per-company folders,
//                                              c08e8ae, 2026-08-28)
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
  const path = parsed.pathname;
  if (!path.startsWith(`/${cloudName}/`)) return false;
  return path.includes(`/${orgFolderFor(orgSlug)}/chat/${senderId}/`) || path.includes(`/cleano/chat/${senderId}/`);
}

import type { MetadataRoute } from "next";
import { workspaceName } from "@/lib/workspace-name";

// Per host: the installed app takes the name of the workspace it was installed
// from (Bookmops on the platform's own host). Forced dynamic because
// workspaceName() swallows errors, so a build-time render would quietly bake
// the platform's name into every tenant's manifest.
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const name = await workspaceName();
  return {
    name,
    short_name: name,
    description: `${name} — bookings, jobs, and crew workspace.`,
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F5F1E8",
    theme_color: "#19356D",
    // Static PNGs, NOT the dynamic /icon/* routes: those rendered 32x32 for
    // every size, so Chrome rejected the manifest (an icon must really be the
    // dimensions it declares) and refused to install the app — "Add to Home
    // screen" produced a browser bookmark instead.
    //
    // The Bookmops symbol, on every host for now: workspaces have no logo of
    // their own to put here yet.
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

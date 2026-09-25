import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cleano",
    short_name: "Cleano",
    description: "Cleano — bookings, jobs, and crew workspace.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F5F1E8",
    theme_color: "#19356D",
    // Static PNGs, NOT the dynamic /icon/* routes: those rendered 32x32 for
    // every size, so Chrome rejected the manifest (an icon must really be the
    // dimensions it declares) and refused to install the app — "Add to Home
    // screen" produced a browser bookmark instead.
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

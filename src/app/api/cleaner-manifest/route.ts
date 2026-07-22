import { NextResponse } from "next/server";

/**
 * Separate PWA manifest for the CREW app.
 *
 * The root manifest uses `start_url: "/"`, which is the customer portal. A
 * cleaner who installed from that manifest lands on "/" every launch, so once
 * their session expires they get bounced to the CUSTOMER login — with no way
 * to change the shortcut's URL from the home screen.
 *
 * Installing from inside /cleaners picks up this manifest instead, so the
 * shortcut opens the crew route directly. Logged out, /cleaners/* redirects to
 * /cleanos/login (the crew door), which is the correct login for that user.
 */
export function GET() {
  return NextResponse.json(
    {
      name: "Cleano Crew",
      short_name: "Cleano Crew",
      description: "Your jobs, schedule, pay, and inventory.",
      // Deep-link straight into the crew app instead of the shared root.
      start_url: "/cleaners/my-jobs",
      scope: "/cleaners",
      display: "standalone",
      orientation: "portrait",
      background_color: "#F5F1E8",
      theme_color: "#008C9C",
      icons: [
        { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json" } }
  );
}

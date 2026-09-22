import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import "./customer.css";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import { getCurrentOrg } from "@/lib/org";
import { STORE_TZ } from "@/lib/timezone";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import MetaPixel from "@/components/MetaPixel";

/**
 * The one family, everywhere (CLN-P1-8-02/03/09).
 *
 * Montserrat is the face the main Dashboard title already used, which the spec
 * names as the target for the whole product. It replaces three parallel
 * systems: TT Norms Pro (forced onto <body>), Manrope (customer + cleaner), and
 * Fraunces (serif-italic accents — the "generic italicised AI-style font" the
 * spec asks to remove). Everything reads it through `--font-app` in globals.css,
 * so a new page inherits it without remembering an opt-in class.
 */
const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cleano",
  description: "Cleano — bookings, jobs, and crew workspace.",
  applicationName: "Cleano",
  appleWebApp: {
    capable: true,
    title: "Cleano",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  // Navy, matching the app's top bar (--primary-deep). It was teal, so the OS
  // status bar sat as a bright green-teal band above a navy header — the seam
  // is the main thing that reads as "a web page in a shell" rather than an app.
  themeColor: "#19356D",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Pinch-zoom stays ENABLED: blocking it (maximumScale 1 / userScalable false)
  // is a WCAG failure, and cleaners read addresses and job notes on small
  // screens in bad light. `touch-action: manipulation` on controls already
  // removes the double-tap-zoom delay, which was the real reason to lock it.
  maximumScale: 5,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Every request passes through here, so it is the one place a workspace can be
  // gated without a guard on each area. getCurrentOrg is cached per request, so
  // this costs one query however many components ask for it.
  //
  // It REDIRECTS rather than rendering the notice in place. Returning early from
  // a layout only hides the page: Next renders children in parallel, so a
  // suspended workspace still served its entire client list -- names, emails,
  // phone numbers -- inside the payload of a screen that said "on hold". A
  // redirect means nothing downstream runs at all.
  //
  // Two paths sit outside the gate. The notice itself, or it would redirect to
  // itself forever; and signup, which belongs to Bookmops rather than to any one
  // workspace -- a visitor creating a company must not be turned away because
  // the host they happened to arrive on has no workspace behind it.
  const path = (await headers()).get("x-awer-path") ?? "";
  const outsideTheGate =
    path.startsWith("/workspace-unavailable") ||
    path.startsWith("/get-started") ||
    // Bookmops' own front page. It describes the product to a stranger and belongs
    // to no workspace, so a missing or suspended one must not hide it.
    path.startsWith("/welcome");
  let org: Awaited<ReturnType<typeof getCurrentOrg>> = null;
  if (!outsideTheGate) {
    org = await getCurrentOrg();
    const blocked = !org
      ? "not-found"
      : org.status === "SUSPENDED"
        ? "suspended"
        : org.status === "CANCELLED"
          ? "cancelled"
          : org.status === "PENDING"
            ? "pending"
            : null;
    if (blocked) {
      const q = new URLSearchParams({ reason: blocked });
      if (org?.name) q.set("name", org.name);
      redirect(`/workspace-unavailable?${q.toString()}`);
    }
  }

  // Sept 10, item 6 part 2 — the browser half of the tenant clock.
  //
  // The server now formats in the workspace's own zone, but a client component
  // has no way to ask: it runs in a browser, where neither the organization
  // context nor the request cache exists. Leaving it out would have been worse
  // than the bug it fixes — the server-rendered half of a page would print
  // Calgary's clock while the interactive half printed Montreal's, on the same
  // screen, and hydration would flip one of them in front of the user.
  //
  // So the answer is stamped on the page. It is a plain global rather than a
  // context provider because `storeTz()` is a synchronous function called from
  // module-level helpers all over the app, not a hook — nothing there can
  // subscribe to a provider. It sits in <head> so it runs at parse time, long
  // before hydration, and `storeTz()` reads it on each call rather than at
  // import, so load order cannot matter.
  //
  // Filtered rather than escaped: `Organization.timezone` is an editable text
  // column, and this value is written into a <script> tag. An IANA zone name
  // is letters, digits, underscore, plus, minus and slash, so anything else is
  // not a zone and does not belong in the page. A rejected value falls back to
  // the deployment default, which is exactly where this file stood before.
  const rawTz = org?.timezone ?? STORE_TZ;
  const pageTz = /^[A-Za-z0-9_+\-/]{1,64}$/.test(rawTz) ? rawTz : STORE_TZ;

  return (
    <html lang="en" className={montserrat.variable}>
      <head>
        {/* Chrome fires `beforeinstallprompt` very early — often BEFORE React
            hydrates, so a listener attached in a component effect misses it
            and no install button ever appears. Capture it here at parse time
            and stash it; InstallProvider picks up the stashed event on mount. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__cleanoTz=${JSON.stringify(pageTz)};`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){window.__cleanoInstallEvent=null;window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__cleanoInstallEvent=e;});window.addEventListener('appinstalled',function(){window.__cleanoInstallEvent=null;});})();`,
          }}
        />
      </head>
      {/* No font class here: the family comes from `body { font-family }` in
          globals.css. The old `!font-tt-norms-pro` was an !important override
          that beat every other rule in the app, which is why three type systems
          could coexist without anyone noticing. */}
      <body suppressHydrationWarning>
        <ServiceWorkerRegistrar />
        {children}
        <MetaPixel />
      </body>
    </html>
  );
}

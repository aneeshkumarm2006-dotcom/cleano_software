import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import "./customer.css";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={montserrat.variable}>
      <head>
        {/* Chrome fires `beforeinstallprompt` very early — often BEFORE React
            hydrates, so a listener attached in a component effect misses it
            and no install button ever appears. Capture it here at parse time
            and stash it; InstallProvider picks up the stashed event on mount. */}
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
      </body>
    </html>
  );
}

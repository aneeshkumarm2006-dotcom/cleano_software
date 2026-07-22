import type { Metadata, Viewport } from "next";
import { Manrope, Fraunces, Montserrat } from "next/font/google";
import "./globals.css";
import "./customer.css";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
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
  themeColor: "#008C9C",
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
    <html lang="en" className={`${fraunces.variable} ${montserrat.variable}`}>
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
      <body className={`!font-tt-norms-pro`} suppressHydrationWarning>
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  );
}

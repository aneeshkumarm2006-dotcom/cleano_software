import type { Metadata, Viewport } from "next";
import { Manrope, Fraunces, Montserrat } from "next/font/google";
import "./globals.css";
import "./customer.css";

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
  // Lock the page from accidentally pinch-zooming, since installed PWA shouldn't behave like a web page.
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${montserrat.variable}`}>
      <body className={`!font-tt-norms-pro`} suppressHydrationWarning>{children}</body>
    </html>
  );
}

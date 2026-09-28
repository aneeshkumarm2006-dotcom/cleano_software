import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { Archivo } from "next/font/google";

import { BookmopsWordmark } from "@/components/BookmopsLogo";
import { ORG_SLUG_HEADER, PLATFORM_ORG_SLUG } from "@/lib/tenant";

import "../welcome/marketing.css";
import "./site.css";

/** Same display face as the front page, so these read as the same site. */
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--mk-font-display",
  display: "swap",
  axes: ["wdth"],
});

/**
 * The frame around Bookmops' plain-text pages (privacy, support).
 *
 * These pages are served on the front door AND on every company's subdomain,
 * because a cleaner inside a company's app needs to reach them from where they
 * already are. On a company's address `/` is that company's customer portal,
 * not Bookmops' home, so the logo only links home on the platform host and the
 * "Start free" pitch is left off — Bookmops' sales button does not belong on a
 * customer's own address.
 */
export default async function SiteShell({ children }: { children: ReactNode }) {
  const onPlatform = (await headers()).get(ORG_SLUG_HEADER) === PLATFORM_ORG_SLUG;

  return (
    <div className={`mk ${archivo.variable}`}>
      <a className="mk-skip" href="#main">
        Skip to content
      </a>

      <header className="mk-nav">
        <div className="mk-wrap mk-nav-in">
          {onPlatform ? (
            <Link href="/" className="mk-logo" aria-label="Bookmops home">
              <BookmopsWordmark height={36} />
            </Link>
          ) : (
            <span className="mk-logo">
              <BookmopsWordmark height={36} />
            </span>
          )}
          <div className="mk-nav-actions">
            <Link href="/support" className="mk-btn mk-btn-plain">
              Support
            </Link>
            <Link href="/privacy" className="mk-btn mk-btn-plain">
              Privacy
            </Link>
            {onPlatform && (
              <Link href="/get-started" className="mk-btn mk-btn-primary mk-hide-sm">
                Start free
              </Link>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="mk-doc-main">
        {children}
      </main>

      <footer className="mk-foot mk-doc-foot">
        <div className="mk-wrap mk-foot-base mk-doc-foot-base">
          <span>&copy; {new Date().getFullYear()} Bookmops</span>
          <nav aria-label="Legal and help" className="mk-doc-foot-links">
            {onPlatform && <Link href="/">Home</Link>}
            <Link href="/support">Support</Link>
            <Link href="/privacy">Privacy Policy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

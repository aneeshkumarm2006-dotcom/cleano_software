"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * A back link that returns you to the list you were actually on.
 *
 * Sept 10, item 14. "Admin was on page 3 of Employees, opened a profile,
 * clicked back, and was returned to page 1." Every detail page linked to the
 * bare list URL, so the page number, the search box, the filters, the sort and
 * the scroll position were all thrown away — even though the lists themselves
 * already keep that state in the query string.
 *
 * So the list state was never lost. The back link simply refused to use it.
 *
 * HOW IT DECIDES. When there is somewhere in-app to go back to, this goes
 * back, which restores the previous URL and, because the browser does it, the
 * scroll position as well. When there is not — a link opened in a new tab, a
 * bookmark, a URL pasted from an email — it behaves as an ordinary link to
 * `href`, which is the only sensible destination in that case.
 *
 * It stays an `<a>` with a real `href` either way, so middle-click and
 * open-in-new-tab keep working and the link is meaningful before hydration.
 */
export default function BackToList({
  href,
  children,
  className,
  style,
}: {
  /** Where to go when there is no in-app history to return to. */
  href: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    // Two independent signals, because neither is reliable alone:
    //
    //   • `history.state.idx` is the App Router's own position counter. It is
    //     the accurate answer for in-app navigation, and it is 0 on a fresh
    //     entry into the site.
    //   • `document.referrer` covers the full page load case, where the router
    //     has no history of its own yet.
    //
    // Wrapped because both can throw in a sandboxed frame, and a back link is
    // never worth an error boundary.
    try {
      const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
      if (idx > 0) {
        setCanGoBack(true);
        return;
      }
      const ref = document.referrer;
      setCanGoBack(
        !!ref && new URL(ref).origin === window.location.origin
      );
    } catch {
      setCanGoBack(false);
    }
  }, []);

  return (
    <a
      href={href}
      className={className}
      style={style}
      onClick={(e) => {
        // Let the browser handle the ways a person asks for a new tab.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        if (!canGoBack) return;
        e.preventDefault();
        router.back();
      }}>
      {children}
    </a>
  );
}

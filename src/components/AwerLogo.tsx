import Link from "next/link";
import { Sparkles } from "lucide-react";

/**
 * Awer's own wordmark, for Awer's own pages.
 *
 * The counterpart to `components/customer/Logo.tsx`, which is a cleaning
 * company's mark and belongs on that company's workspace. This one belongs on
 * the front door: the marketing page, signup, and the staff console — anywhere
 * the visitor is dealing with Awer rather than with one of its customers.
 *
 * Keeping the two apart is the whole point. Before this existed, `SplitShell`
 * always rendered the customer mark, so a cleaning company signing up for Awer
 * was greeted by another cleaning company's logo.
 */
export default function AwerLogo({
  onDark,
  href = "/",
}: {
  onDark?: boolean;
  href?: string;
}) {
  return (
    <Link href={href} className={`cl-logo ${onDark ? "cl-logo-on-dark" : ""}`}>
      <span className="cl-logo-mark">
        <Sparkles size={18} strokeWidth={1.8} />
      </span>
      <span>awer</span>
    </Link>
  );
}

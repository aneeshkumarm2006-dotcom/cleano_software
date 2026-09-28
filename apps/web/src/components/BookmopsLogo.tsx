import Image from "next/image";
import Link from "next/link";

/**
 * Bookmops' own mark, for Bookmops' own pages.
 *
 * The counterpart to `components/customer/Logo.tsx`, which is a cleaning
 * company's mark and belongs on that company's workspace. This one belongs on
 * the front door: the marketing page, signup, and the staff console — anywhere
 * the visitor is dealing with Bookmops rather than with one of its customers.
 *
 * Keeping the two apart is the whole point. Before this existed, `SplitShell`
 * always rendered the customer mark, so a cleaning company signing up for Bookmops
 * was greeted by another cleaning company's logo.
 *
 * The artwork lives in public/brand/. Both files are transparent PNGs cut from
 * the supplied artwork on white. The wordmark's blue "B" is too dark to read on
 * navy, so on a dark surface the logo is the symbol plus the name set in white.
 */

/** 480×157 source. */
const WORDMARK = { src: "/brand/bookmops-wordmark.png", ratio: 480 / 157 };
/** 256×110 source. */
const SYMBOL = { src: "/brand/bookmops-symbol.png", ratio: 256 / 110 };

/** The full "Bookmops" wordmark with its check underline. Light surfaces only. */
export function BookmopsWordmark({ height = 36 }: { height?: number }) {
  return (
    <Image
      src={WORDMARK.src}
      alt="Bookmops"
      width={Math.round(height * WORDMARK.ratio)}
      height={height}
      priority
      style={{ display: "block", flex: "none" }}
    />
  );
}

/**
 * The spray-bottle infinity symbol on its own. Decorative by default, because
 * it always sits next to the name, which already says "Bookmops".
 */
export function BookmopsSymbol({
  height = 24,
  alt = "",
}: {
  height?: number;
  alt?: string;
}) {
  return (
    <Image
      src={SYMBOL.src}
      alt={alt}
      width={Math.round(height * SYMBOL.ratio)}
      height={height}
      priority
      style={{ display: "block", flex: "none" }}
    />
  );
}

export default function BookmopsLogo({
  onDark,
  href = "/",
}: {
  onDark?: boolean;
  href?: string;
}) {
  if (onDark) {
    return (
      <Link href={href} className="cl-logo cl-logo-on-dark">
        <BookmopsSymbol height={24} />
        <span>Bookmops</span>
      </Link>
    );
  }
  return (
    <Link href={href} className="cl-logo">
      <BookmopsWordmark height={36} />
    </Link>
  );
}

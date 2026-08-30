import Link from "next/link";
import { Star } from "lucide-react";
import CustomerLogo from "./Logo";

export const BRAND_IMAGES = {
  login:
    "https://images.unsplash.com/photo-1631679706909-1844bbd07221?w=1400&q=80&auto=format&fit=crop",
  setup:
    "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1400&q=80&auto=format&fit=crop",
  // Custom branded art for the "Set your password" (change-password) page.
  changePassword: "/change-password.png",
  rate:
    "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1400&q=80&auto=format&fit=crop",
  home:
    "https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=1600&q=80&auto=format&fit=crop",
} as const;

interface SplitShellProps {
  image?: string;
  // CSS background-position for the brand image (default "center"). Use e.g.
  // "center top" to keep a portrait subject's head from being cropped.
  imagePosition?: string;
  // HTML string (may include <br/> and <em>...</em>) for the brand quote
  quoteHtml?: string;
  quoteSub?: string;
  topRightLabel?: string;
  topRightHref?: string;
  badge?: string;
  /**
   * Wordmark in the top-left of the brand panel. Defaults to the cleaning
   * company's own logo, which is right on a workspace host and wrong on Awer's.
   */
  logo?: React.ReactNode;
  /**
   * The line along the bottom of the brand panel, with its stars.
   *
   * This used to be the hardcoded string "Loved by 2,400+ Montréal homes",
   * which is one specific cleaning company's marketing. It was rendering on
   * every page that uses this shell — including Awer's OWN signup page, so a
   * cleaning company evaluating the product was shown a competitor's customer
   * count. Pass `null` to omit the line and its stars entirely.
   */
  footNote?: React.ReactNode;
  children: React.ReactNode;
}

export default function SplitShell({
  image,
  imagePosition,
  quoteHtml,
  quoteSub,
  topRightLabel,
  topRightHref,
  badge,
  logo,
  footNote = "Loved by 2,400+ Montréal homes",
  children,
}: SplitShellProps) {
  return (
    <div className="cl-customer">
      <div
        className="cl-split cl-fade-up"
        style={
          { "--brand-image": image ? `url(${image})` : "none" } as React.CSSProperties
        }>
        <aside
          className="cl-split-brand"
          style={
            {
              "--brand-image": image ? `url(${image})` : "none",
              "--brand-pos": imagePosition ?? "center",
            } as React.CSSProperties
          }>
          <div className="cl-split-brand-top">
            {logo ?? <CustomerLogo onDark />}
            {badge ? (
              <span
                style={{
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  opacity: 0.7,
                  fontWeight: 600,
                }}>
                {badge}
              </span>
            ) : null}
          </div>
          <div className="cl-split-brand-body">
            {quoteHtml ? (
              <p
                className="cl-split-brand-quote"
                dangerouslySetInnerHTML={{ __html: quoteHtml }}
              />
            ) : null}
            {quoteSub ? <p className="cl-split-brand-sub">{quoteSub}</p> : null}
          </div>
          {footNote ? (
            <div className="cl-split-brand-foot">
              <span style={{ display: "inline-flex", gap: 4 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    size={11}
                    fill="#facc15"
                    stroke="none"
                    style={{ color: "#facc15" }}
                  />
                ))}
              </span>
              <span>{footNote}</span>
            </div>
          ) : null}
        </aside>

        <section className="cl-split-form">
          <div className="cl-split-form-top">
            {topRightLabel && topRightHref ? (
              <Link href={topRightHref} className="cl-link">
                {topRightLabel}
              </Link>
            ) : null}
          </div>
          <div className="cl-split-form-body">
            <div className="cl-split-form-inner cl-fade-up-2">{children}</div>
          </div>
        </section>
      </div>
    </div>
  );
}

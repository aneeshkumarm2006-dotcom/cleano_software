import Link from "next/link";
import { getSetting, getSettings } from "@/lib/settings";

// Same content the public /faq page renders, and the same reason for rendering
// per request: an admin edit in Settings → Website & FAQ must show up here
// immediately, not at the next build.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "FAQ · My Cleano",
};

export default async function PortalFaqPage() {
  // One source of truth: the `content.faqs` AppSetting, read through the same
  // accessor as /faq. Forking the content would mean the admin editor silently
  // only updates one of the two pages.
  const faqs = await getSetting("content.faqs");
  const {
    "general.businessEmail": businessEmail,
    "general.businessPhone": businessPhone,
  } = await getSettings(["general.businessEmail", "general.businessPhone"]);

  return (
    <>
      <header style={{ marginBottom: 36 }}>
        <div className="cl-stack-8">
          <p className="cl-eyebrow">Help centre</p>
          <h1 className="cl-display" style={{ fontSize: "clamp(34px, 4.2vw, 48px)" }}>
            Questions.
          </h1>
          <p className="cl-subtitle" style={{ maxWidth: 560 }}>
            Answers to the things customers ask us most. Can&apos;t find what
            you need? Get in touch and a real person will help.
          </p>
        </div>
      </header>

      {faqs.length === 0 ? (
        <div className="cl-tile cl-tile-pad-lg" style={{ textAlign: "center" }}>
          <p className="cl-subtitle" style={{ margin: 0 }}>
            No questions have been published yet. Contact us and we&apos;ll help
            you directly.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {faqs.map((f, i) => (
            <details key={i} className="cl-faq-item">
              <summary className="cl-faq-q">
                <span>{f.question}</span>
                <span className="cl-faq-chevron" aria-hidden="true" />
              </summary>
              <p className="cl-faq-a">{f.answer}</p>
            </details>
          ))}
        </div>
      )}

      <div className="cl-tile cl-tile-pad-lg" style={{ marginTop: 28 }}>
        <h2 className="cl-title-md" style={{ marginBottom: 6 }}>
          Still need a hand?
        </h2>
        <p className="cl-subtitle" style={{ margin: "0 0 16px" }}>
          Message us about anything that isn&apos;t answered above. For
          something specific to one cleaning, the chat on that booking reaches
          your cleaner directly.
        </p>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
          }}>
          {businessEmail && (
            <a className="cl-btn cl-btn-primary" href={`mailto:${businessEmail}`}>
              Email us
            </a>
          )}
          {businessPhone && (
            <a className="cl-btn" href={`tel:${businessPhone}`}>
              {businessPhone}
            </a>
          )}
          <Link className="cl-btn" href="/bookings">
            Go to my bookings
          </Link>
        </div>
      </div>
    </>
  );
}

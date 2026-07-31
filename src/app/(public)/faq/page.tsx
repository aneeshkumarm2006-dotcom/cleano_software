import { getSetting } from "@/lib/settings";
import FaqAccordion from "@/components/FaqAccordion";

// Content is admin-editable, so render per request (not frozen at build).
export const dynamic = "force-dynamic";

export const metadata = {
  title: "FAQ · Cleano",
  description: "Frequently asked questions about Cleano cleaning services.",
};

export default async function FaqPage() {
  const faqs = await getSetting("content.faqs");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f7faf9 0%, #ffffff 100%)",
        padding: "48px 16px",
      }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <header style={{ marginBottom: 28, textAlign: "center" }}>
          <div
            style={{
              fontSize: 12,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#008C9C",
              fontWeight: 700,
            }}>
            Cleano
          </div>
          <h1
            style={{
              marginTop: 8,
              fontSize: "clamp(28px, 5vw, 44px)",
              lineHeight: 1.1,
              color: "#0a1f24",
              fontWeight: 700,
            }}>
            Frequently asked questions
          </h1>
        </header>

        {/* Search + accordion are shared with the in-portal /help page so the
            two surfaces can't drift. Filtering is client-side over this list. */}
        <FaqAccordion faqs={faqs} />
      </div>
    </div>
  );
}

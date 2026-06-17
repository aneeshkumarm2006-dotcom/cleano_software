import { getSetting } from "@/lib/settings";

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

        {faqs.length === 0 ? (
          <p style={{ textAlign: "center", color: "#3a5a62", fontSize: 15 }}>
            No FAQs are available right now. Please contact our office for help.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {faqs.map((f, i) => (
              <details
                key={i}
                style={{
                  background: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: 14,
                  padding: "16px 20px",
                }}>
                <summary
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: "#0a1f24",
                    cursor: "pointer",
                    listStyle: "none",
                  }}>
                  {f.question}
                </summary>
                <p
                  style={{
                    marginTop: 10,
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: "#3a5a62",
                    whiteSpace: "pre-wrap",
                  }}>
                  {f.answer}
                </p>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import QuoteFormClient from "./QuoteFormClient";

export const metadata = {
  title: "Request a Quote · Cleano",
  description:
    "Tell us about your space and we'll send you a tailored cleaning quote.",
};

export default function QuotePage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f7faf9 0%, #ffffff 100%)",
        padding: "48px 16px",
      }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <header style={{ marginBottom: 32, textAlign: "center" }}>
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
              fontSize: "clamp(32px, 5vw, 48px)",
              lineHeight: 1.1,
              color: "#0a1f24",
              fontWeight: 700,
            }}>
            Request a quote
          </h1>
          <p
            style={{
              marginTop: 12,
              fontSize: 16,
              color: "#3a5a62",
              lineHeight: 1.5,
            }}>
            Tell us a few details about your space and we'll get back to you
            within one business day with a tailored estimate.
          </p>
        </header>

        <QuoteFormClient />
      </div>
    </div>
  );
}

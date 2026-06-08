import CareersFormClient from "./CareersFormClient";

export const metadata = {
  title: "Apply to Work With Us · Cleano",
  description: "Join the Cleano cleaning team — apply online in a few minutes.",
};

export default function CareersPage() {
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
              color: "#005F6A",
              fontWeight: 700,
            }}>
            Cleano Careers
          </div>
          <h1
            style={{
              marginTop: 8,
              fontSize: "clamp(32px, 5vw, 48px)",
              lineHeight: 1.1,
              color: "#0a1f24",
              fontWeight: 700,
            }}>
            Apply to work with us
          </h1>
          <p
            style={{
              marginTop: 12,
              fontSize: 16,
              color: "#3a5a62",
              lineHeight: 1.5,
            }}>
            We&apos;re always looking for reliable, detail-oriented cleaners. Tell us
            about yourself and we&apos;ll be in touch.
          </p>
        </header>

        <CareersFormClient />
      </div>
    </div>
  );
}

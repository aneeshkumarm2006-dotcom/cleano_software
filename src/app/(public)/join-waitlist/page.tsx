"use client";

import { useState, useTransition } from "react";
import { joinWaitlist } from "../actions/joinWaitlist";
import PremiumSelect from "@/components/ui/PremiumSelect";
import DatePicker from "@/components/ui/DatePicker";

const SERVICE_TYPES = [
  { value: "standard", label: "Standard Clean" },
  { value: "deep", label: "Deep Clean" },
  { value: "move-in", label: "Move-In / Move-Out" },
  { value: "office", label: "Office Clean" },
];

const inputStyle: React.CSSProperties = {
  width: "100%", height: 48, borderRadius: 12,
  border: "1px solid rgba(0,140,156,0.16)", background: "#fff",
  padding: "0 16px", fontSize: 14, color: "#1a1a1a",
  fontFamily: "inherit", outline: "none",
  transition: "border-color .15s, box-shadow .15s",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  paddingRight: 40, cursor: "pointer", appearance: "none" as const,
  backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='%23008C9C' stroke-width='2' stroke-linecap='round'><polyline points='3,5 6,8 9,5'/></svg>\")",
  backgroundRepeat: "no-repeat", backgroundPosition: "right 14px center", backgroundSize: "12px",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle, height: "auto", padding: "14px 16px", resize: "none" as const,
};

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const,
  letterSpacing: "0.09em", color: "rgba(0,140,156,0.65)", marginBottom: 6,
};

export default function JoinWaitlistPage() {
  const [isPending, startTransition] = useTransition();
  const [success, setSuccess] = useState(false);
  const [successData, setSuccessData] = useState<{ name?: string; email?: string; date?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serviceType, setServiceType] = useState("");
  const [bedCount, setBedCount] = useState("");
  const [bathCount, setBathCount] = useState("");
  const [preferredDate, setPreferredDate] = useState("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const preferredDate = formData.get("preferredDate") as string;
    startTransition(async () => {
      const result = await joinWaitlist(formData);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccessData({ name: name || undefined, email, date: preferredDate || undefined });
        setSuccess(true);
      }
    });
  }

  if (success && successData) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(160deg, #f9f6f1 0%, #fff 60%)", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
        <div style={{ maxWidth: 480, width: "100%", textAlign: "center" }}>
          <div style={{
            width: 72, height: 72, borderRadius: "50%",
            background: "linear-gradient(135deg, #059669, #10b981)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 28px", boxShadow: "0 8px 24px rgba(5,150,105,0.25)",
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <h1 style={{
            fontFamily: "var(--font-app)", fontSize: 36, fontWeight: 300,
            color: "#0a2e32", lineHeight: 1.1, margin: "0 0 12px", letterSpacing: "-0.02em",
          }}>
            {successData.name ? `You're on the list, ${successData.name.split(" ")[0]}!` : "You're on the list!"}
          </h1>
          <p style={{ fontSize: 15, color: "rgba(0,140,156,0.65)", lineHeight: 1.6, margin: "0 0 8px" }}>
            We&rsquo;ll reach out to <strong style={{ color: "#008C9C" }}>{successData.email}</strong> as soon as a slot opens up
            {successData.date ? ` on or near ${new Date(successData.date + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" })}` : ""}.
          </p>
          <p style={{ fontSize: 13, color: "rgba(0,140,156,0.45)", lineHeight: 1.5, margin: 0 }}>
            We typically confirm within 24 hours.
          </p>

          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 32, flexWrap: "wrap" }}>
            <a href="/" style={{
              display: "inline-flex", alignItems: "center", height: 44, padding: "0 24px",
              borderRadius: 12, background: "#008C9C", color: "#fff",
              fontSize: 14, fontWeight: 600, textDecoration: "none",
              fontFamily: "inherit",
            }}>
              Back to home
            </a>
            <a href="/book" style={{
              display: "inline-flex", alignItems: "center", height: 44, padding: "0 24px",
              borderRadius: 12, background: "#fff", color: "#008C9C",
              border: "1.5px solid rgba(0,140,156,0.2)",
              fontSize: 14, fontWeight: 600, textDecoration: "none",
              fontFamily: "inherit",
            }}>
              Try another date →
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg, #f9f6f1 0%, #fff 60%)" }}>
      {/* Header */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "20px 32px", maxWidth: 760, margin: "0 auto",
      }}>
        <a href="/" style={{ fontFamily: "var(--font-app)", fontSize: 20, fontWeight: 400, color: "#008C9C", textDecoration: "none", letterSpacing: "-0.01em" }}>
          Cleano
        </a>
        <a href="/book" style={{ fontSize: 13, color: "#008C9C", textDecoration: "none", fontWeight: 600, opacity: 0.7 }}>
          Book a cleaning →
        </a>
      </header>

      <main style={{ maxWidth: 580, margin: "0 auto", padding: "0 20px 80px" }}>
        {/* Hero */}
        <div style={{ padding: "32px 0 36px", textAlign: "center" }}>
          <p style={{
            fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em",
            color: "rgba(0,140,156,0.55)", margin: "0 0 14px",
          }}>
            Waitlist
          </p>
          <h1 style={{
            fontFamily: "var(--font-app)", fontSize: "clamp(34px, 6vw, 52px)",
            fontWeight: 300, color: "#0a2e32", lineHeight: 1.08,
            letterSpacing: "-0.025em", margin: "0 0 14px",
          }}>
            Booked up? Join the{" "}
            <em style={{ fontStyle: "normal", color: "#008C9C" }}>waitlist.</em>
          </h1>
          <p style={{ fontSize: 15, color: "rgba(0,140,156,0.6)", lineHeight: 1.6, margin: 0 }}>
            Leave your details and we&rsquo;ll reach out the moment a slot opens up on your preferred date.
          </p>
        </div>

        {/* Form card */}
        <div style={{
          background: "#fff", borderRadius: 20,
          boxShadow: "0 2px 24px rgba(0,140,156,0.08), 0 1px 4px rgba(0,0,0,0.04)",
          padding: "32px",
        }}>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Name + Email */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={labelStyle}>Full name</label>
                <input name="name" type="text" placeholder="Jane Smith" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Email <span style={{ color: "#e11d48" }}>*</span></label>
                <input name="email" type="email" required placeholder="jane@example.com" style={inputStyle} />
              </div>
            </div>

            {/* Phone + Date */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={labelStyle}>Phone</label>
                <input name="phone" type="tel" placeholder="(555) 000-0000" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Preferred date <span style={{ color: "#e11d48" }}>*</span></label>
                <DatePicker
                  name="preferredDate"
                  value={preferredDate}
                  onChange={setPreferredDate}
                  min={new Date().toISOString().slice(0, 10)}
                  size="md"
                />
              </div>
            </div>

            {/* Service + Bedrooms */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={labelStyle}>Service type</label>
                <PremiumSelect
                  name="serviceType"
                  value={serviceType}
                  onChange={setServiceType}
                  options={[{ value: "", label: "Select a service…" }, ...SERVICE_TYPES]}
                  placeholder="Select a service…"
                  size="md"
                />
              </div>
              <div>
                <label style={labelStyle}>Bedrooms</label>
                <PremiumSelect
                  name="bedCount"
                  value={bedCount}
                  onChange={setBedCount}
                  options={[{ value: "", label: "—" }, ...[1, 2, 3, 4, 5, 6].map(n => ({ value: String(n), label: String(n) }))]}
                  placeholder="—"
                  size="md"
                />
              </div>
            </div>

            {/* Bathrooms */}
            <div style={{ maxWidth: "50%" }}>
              <label style={labelStyle}>Bathrooms</label>
              <PremiumSelect
                name="bathCount"
                value={bathCount}
                onChange={setBathCount}
                options={[{ value: "", label: "—" }, ...[1, 1.5, 2, 2.5, 3, 3.5, 4].map(n => ({ value: String(n), label: String(n) }))]}
                placeholder="—"
                size="md"
              />
            </div>

            {/* Notes */}
            <div>
              <label style={labelStyle}>Notes</label>
              <textarea
                name="notes"
                rows={3}
                placeholder="Pets, flexible dates, special instructions, etc."
                style={textareaStyle}
              />
            </div>

            {error && (
              <div style={{
                background: "#fef2f2", border: "1px solid #fecaca",
                borderRadius: 10, padding: "12px 16px",
                fontSize: 13, color: "#b91c1c",
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isPending}
              style={{
                width: "100%", height: 52, borderRadius: 14,
                background: isPending ? "rgba(0,140,156,0.5)" : "#008C9C",
                color: "#fff", fontSize: 15, fontWeight: 600,
                fontFamily: "inherit", border: 0, cursor: isPending ? "not-allowed" : "pointer",
                transition: "background .15s",
                boxShadow: "0 4px 16px rgba(0,140,156,0.25)",
              }}>
              {isPending ? "Submitting…" : "Join the Waitlist"}
            </button>

            <p style={{ textAlign: "center", fontSize: 12, color: "rgba(0,140,156,0.4)", margin: 0 }}>
              We&rsquo;ll never share your information. No spam, ever.
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}

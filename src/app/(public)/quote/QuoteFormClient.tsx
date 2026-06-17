"use client";

import { useState, useTransition } from "react";
import { submitQuote } from "./actions/submitQuote";

const SERVICE_OPTIONS = [
  "Standard cleaning",
  "Deep cleaning",
  "Move-in / Move-out",
  "Post-construction",
  "Recurring service",
  "Commercial",
  "Other",
];

export default function QuoteFormClient() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [bedCount, setBedCount] = useState("");
  const [bathCount, setBathCount] = useState("");
  const [squareFootage, setSquareFootage] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await submitQuote({
        name,
        email,
        phone: phone || undefined,
        address: address || undefined,
        serviceType: serviceType || undefined,
        bedCount: bedCount ? Number(bedCount) : undefined,
        bathCount: bathCount ? Number(bathCount) : undefined,
        squareFootage: squareFootage ? Number(squareFootage) : undefined,
        preferredDate: preferredDate || undefined,
        message: message || undefined,
      });
      if (!result.success) {
        setError(result.error ?? "Could not submit");
        return;
      }
      setDone(true);
    });
  }

  if (done) {
    return (
      <div
        style={{
          padding: 32,
          background: "#fff",
          border: "1px solid rgba(0,140,156,0.12)",
          borderRadius: 16,
          textAlign: "center",
        }}>
        <h2 style={{ margin: 0, fontSize: 22, color: "#008C9C" }}>
          Got it — we'll be in touch
        </h2>
        <p style={{ marginTop: 12, fontSize: 14, color: "#3a5a62", lineHeight: 1.6 }}>
          Thanks for the details. A member of our team will follow up by email
          within one business day with pricing and next steps.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: "#fff",
        border: "1px solid rgba(0,140,156,0.12)",
        borderRadius: 16,
        padding: 28,
        boxShadow: "0 8px 24px rgba(0,140,156,0.06)",
      }}>
      <Row>
        <Field label="Full name" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={inputStyle}
          />
        </Field>
        <Field label="Email" required>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
        </Field>
      </Row>

      <Row>
        <Field label="Phone">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Service type">
          <select
            value={serviceType}
            onChange={(e) => setServiceType(e.target.value)}
            style={inputStyle}>
            <option value="">Select…</option>
            {SERVICE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </Row>

      <Field label="Address">
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          style={inputStyle}
        />
      </Field>

      <Row>
        <Field label="Bedrooms">
          <input
            type="number"
            min={0}
            value={bedCount}
            onChange={(e) => setBedCount(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Bathrooms">
          <input
            type="number"
            min={0}
            value={bathCount}
            onChange={(e) => setBathCount(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Square footage">
          <input
            type="number"
            min={0}
            value={squareFootage}
            onChange={(e) => setSquareFootage(e.target.value)}
            style={inputStyle}
          />
        </Field>
      </Row>

      <Field label="Preferred date">
        <input
          type="date"
          value={preferredDate}
          onChange={(e) => setPreferredDate(e.target.value)}
          style={inputStyle}
        />
      </Field>

      <Field label="Anything else we should know?">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
          placeholder="Special access instructions, pets, preferred products…"
        />
      </Field>

      {error && (
        <p
          style={{
            marginTop: 12,
            color: "#dc2626",
            fontSize: 13,
            fontWeight: 600,
          }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        style={{
          marginTop: 20,
          width: "100%",
          padding: "14px 16px",
          fontSize: 15,
          fontWeight: 700,
          color: "#fff",
          background: pending ? "#7daab0" : "#008C9C",
          border: "none",
          borderRadius: 10,
          cursor: pending ? "default" : "pointer",
        }}>
        {pending ? "Sending…" : "Request my quote"}
      </button>
    </form>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 16,
        marginBottom: 16,
      }}>
      {children}
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", marginBottom: 16 }}>
      <span
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 600,
          color: "#3a5a62",
          marginBottom: 6,
          letterSpacing: "0.02em",
        }}>
        {label}
        {required && <span style={{ color: "#dc2626" }}> *</span>}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  fontSize: 14,
  color: "#0a1f24",
  background: "#fff",
  border: "1px solid rgba(0,140,156,0.18)",
  borderRadius: 8,
};

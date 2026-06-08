"use client";

import { useState, useRef } from "react";
import { submitJobApplication } from "./actions/submitJobApplication";
import { uploadResume } from "./actions/uploadResume";

const FIELD: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: "1px solid #d6e2e0",
  padding: "11px 13px",
  fontSize: 15,
  color: "#0a1f24",
  background: "#fff",
  outline: "none",
};
const LABEL: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "#0a1f24",
  marginBottom: 6,
};

export default function CareersFormClient() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    cityArea: "",
    availability: "",
    experience: "",
    hasTransport: "" as "" | "yes" | "no",
    notes: "",
  });
  const [resumeUrl, setResumeUrl] = useState<string | null>(null);
  const [resumeName, setResumeName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await uploadResume(fd);
    setUploading(false);
    if (res.success && res.url) {
      setResumeUrl(res.url);
      setResumeName(file.name);
    } else {
      setError(res.error ?? "Resume upload failed");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.includes("@") || !form.phone.trim()) {
      setError("Name, email, and phone are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await submitJobApplication({
      name: form.name,
      email: form.email,
      phone: form.phone,
      cityArea: form.cityArea,
      availability: form.availability,
      experience: form.experience,
      hasTransport:
        form.hasTransport === "" ? null : form.hasTransport === "yes",
      resumeUrl,
      notes: form.notes,
    });
    setSubmitting(false);
    if (res.success) setDone(true);
    else setError(res.error ?? "Something went wrong");
  }

  if (done) {
    return (
      <div
        style={{
          background: "#fff",
          border: "1px solid #d6e2e0",
          borderRadius: 16,
          padding: 32,
          textAlign: "center",
        }}>
        <h2 style={{ fontSize: 22, color: "#0a1f24", fontWeight: 700, marginBottom: 8 }}>
          Application received
        </h2>
        <p style={{ color: "#3a5a62", fontSize: 15 }}>
          Thanks for applying! We&apos;ve sent a confirmation to your email. Our
          hiring team will reach out if you&apos;re a good fit.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: "#fff",
        border: "1px solid #d6e2e0",
        borderRadius: 16,
        padding: 28,
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <label style={LABEL}>Full name *</label>
          <input style={FIELD} value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </div>
        <div>
          <label style={LABEL}>Phone *</label>
          <input style={FIELD} value={form.phone} onChange={(e) => set("phone", e.target.value)} required />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <label style={LABEL}>Email *</label>
          <input style={FIELD} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
        </div>
        <div>
          <label style={LABEL}>City / area</label>
          <input style={FIELD} value={form.cityArea} onChange={(e) => set("cityArea", e.target.value)} placeholder="e.g. Montréal, West Island" />
        </div>
      </div>

      <div>
        <label style={LABEL}>Availability</label>
        <input style={FIELD} value={form.availability} onChange={(e) => set("availability", e.target.value)} placeholder="e.g. Weekday mornings, full-time" />
      </div>

      <div>
        <label style={LABEL}>Cleaning experience</label>
        <textarea style={{ ...FIELD, resize: "vertical" }} rows={3} value={form.experience} onChange={(e) => set("experience", e.target.value)} placeholder="Tell us about any relevant experience" />
      </div>

      <div>
        <label style={LABEL}>Do you have reliable transportation?</label>
        <div style={{ display: "flex", gap: 18, marginTop: 4 }}>
          {(["yes", "no"] as const).map((v) => (
            <label key={v} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 15, color: "#0a1f24", cursor: "pointer" }}>
              <input type="radio" name="transport" checked={form.hasTransport === v} onChange={() => set("hasTransport", v)} />
              {v === "yes" ? "Yes" : "No"}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label style={LABEL}>Resume (optional)</label>
        <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,image/*" onChange={handleFile} disabled={uploading} style={{ fontSize: 14 }} />
        {uploading && <p style={{ fontSize: 13, color: "#3a5a62", marginTop: 6 }}>Uploading…</p>}
        {resumeName && !uploading && (
          <p style={{ fontSize: 13, color: "#15803d", marginTop: 6 }}>Attached: {resumeName}</p>
        )}
      </div>

      <div>
        <label style={LABEL}>Anything else?</label>
        <textarea style={{ ...FIELD, resize: "vertical" }} rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>

      {error && <p style={{ color: "#b91c1c", fontSize: 14 }}>{error}</p>}

      <button
        type="submit"
        disabled={submitting || uploading}
        style={{
          background: "#005F6A",
          color: "#fff",
          border: "none",
          borderRadius: 10,
          padding: "13px 0",
          fontSize: 16,
          fontWeight: 600,
          cursor: submitting || uploading ? "not-allowed" : "pointer",
          opacity: submitting || uploading ? 0.6 : 1,
        }}>
        {submitting ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}

"use client";

import { useState, useRef } from "react";
import { Check, AlertCircle, Paperclip } from "lucide-react";
import { submitJobApplication } from "./actions/submitJobApplication";
import { uploadResume } from "./actions/uploadResume";

function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3c-1 2-6 7-6 11a6 6 0 0 0 12 0c0-4-5-9-6-11z"
        fill="currentColor"
      />
    </svg>
  );
}

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

  const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setResumeUrl(null);
    setResumeName(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await uploadResume(fd);
    setUploading(false);
    if (res.success && res.url) {
      setResumeUrl(res.url);
      setResumeName(file.name);
    } else {
      setError(res.error ?? "Résumé upload failed.");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setError("Please enter your full name.");
    if (!emailOk(form.email)) return setError("Please enter a valid email address.");
    if (!form.phone.trim()) return setError("Please enter a phone number.");
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
    else setError(res.error ?? "Something went wrong. Please try again.");
  }

  function resetForm() {
    setForm({
      name: "",
      email: "",
      phone: "",
      cityArea: "",
      availability: "",
      experience: "",
      hasTransport: "",
      notes: "",
    });
    setResumeUrl(null);
    setResumeName(null);
    setError(null);
    setDone(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="cr-stage">
      <div className="cr-col">
        <header className="cr-header">
          <div className="cr-brand">
            <span className="cr-logo">
              <LogoMark size={20} />
            </span>
            <span className="cr-eyebrow">Cleano Careers</span>
          </div>
          <h1 className="display cr-title">
            {done ? (
              <>
                Application <em>received.</em>
              </>
            ) : (
              <>
                Apply to work <em>with us.</em>
              </>
            )}
          </h1>
          <p className="subtitle cr-sub">
            {done
              ? "Thanks for applying — our team will review your details and reach out soon."
              : "Join a team that takes pride in spotless work and treats its cleaners right. Tell us a little about yourself."}
          </p>
        </header>

        {done ? (
          <div className="cr-card cr-success">
            <span className="cr-success-mark">
              <Check size={30} />
            </span>
            <h2 className="cr-success-title">
              You&apos;re all set, {form.name.split(" ")[0] || "there"}.
            </h2>
            <p className="cr-success-body">
              We&apos;ve received your application
              {resumeName ? (
                <>
                  {" "}
                  and your résumé (<strong>{resumeName}</strong>)
                </>
              ) : null}
              . Expect to hear from us at <strong>{form.email}</strong> within a
              few business days.
            </p>
            <div className="cr-success-meta">
              <div>
                <span>Name</span>
                {form.name}
              </div>
              <div>
                <span>Email</span>
                {form.email}
              </div>
              <div>
                <span>Phone</span>
                {form.phone}
              </div>
              {form.cityArea ? (
                <div>
                  <span>Area</span>
                  {form.cityArea}
                </div>
              ) : null}
            </div>
            <button className="btn btn-secondary btn-block" onClick={resetForm}>
              Submit another application
            </button>
          </div>
        ) : (
          <form className="cr-card" onSubmit={handleSubmit} noValidate>
            <div className="cr-grid">
              <div className="field">
                <label className="label">
                  Full name <span className="cr-req">*</span>
                </label>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Jordan Lévesque"
                />
              </div>
              <div className="field">
                <label className="label">
                  Phone <span className="cr-req">*</span>
                </label>
                <input
                  className="input"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="(514) 555-0123"
                />
              </div>
            </div>

            <div className="cr-grid">
              <div className="field">
                <label className="label">
                  Email <span className="cr-req">*</span>
                </label>
                <input
                  className="input"
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="you@email.com"
                />
              </div>
              <div className="field">
                <label className="label">City / area</label>
                <input
                  className="input"
                  value={form.cityArea}
                  onChange={(e) => set("cityArea", e.target.value)}
                  placeholder="Plateau, Verdun…"
                />
              </div>
            </div>

            <div className="field">
              <label className="label">Availability</label>
              <input
                className="input"
                value={form.availability}
                onChange={(e) => set("availability", e.target.value)}
                placeholder="e.g. Weekday mornings, full-time"
              />
            </div>

            <div className="field">
              <label className="label">Cleaning experience</label>
              <textarea
                className="textarea"
                rows={3}
                value={form.experience}
                onChange={(e) => set("experience", e.target.value)}
                placeholder="Tell us about any relevant experience — residential, commercial, hospitality…"
              />
            </div>

            <div className="field">
              <label className="label">Reliable transportation?</label>
              <div className="cr-radios">
                {(["yes", "no"] as const).map((opt) => (
                  <button
                    type="button"
                    key={opt}
                    className={`cr-radio ${form.hasTransport === opt ? "on" : ""}`}
                    onClick={() => set("hasTransport", opt)}>
                    <span className="cr-radio-dot">
                      {form.hasTransport === opt ? <span /> : null}
                    </span>
                    {opt === "yes" ? "Yes" : "No"}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label className="label">Résumé</label>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,image/*"
                hidden
                onChange={handleFile}
              />
              <button
                type="button"
                className={`cr-upload ${resumeName ? "done" : ""}`}
                disabled={uploading}
                onClick={() => fileRef.current?.click()}>
                {uploading ? (
                  <>
                    <span className="cr-spinner" /> Uploading…
                  </>
                ) : resumeName ? (
                  <>
                    <span className="cr-upload-ic done">
                      <Check size={16} />
                    </span>
                    <span>
                      Attached: <strong>{resumeName}</strong>
                    </span>
                    <span className="cr-upload-replace">Replace</span>
                  </>
                ) : (
                  <>
                    <span className="cr-upload-ic">
                      <Paperclip size={16} />
                    </span>
                    <span>
                      Upload your résumé{" "}
                      <span className="cr-upload-hint">(PDF or Word)</span>
                    </span>
                  </>
                )}
              </button>
            </div>

            <div className="field">
              <label className="label">Anything else?</label>
              <textarea
                className="textarea"
                rows={2}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="Optional — anything you'd like us to know."
              />
            </div>

            {error ? (
              <div className="banner banner-error cr-error">
                <AlertCircle size={16} /> {error}
              </div>
            ) : null}

            <button
              className="btn btn-primary btn-lg btn-block"
              type="submit"
              disabled={submitting || uploading}>
              {submitting ? "Submitting…" : "Submit application"}
            </button>
            <p className="cr-fineprint">
              By applying you agree to be contacted about employment
              opportunities at Cleano.
            </p>
          </form>
        )}

        <footer className="cr-footer">© 2026 Cleano · Montréal, QC</footer>
      </div>
    </div>
  );
}

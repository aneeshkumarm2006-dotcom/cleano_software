"use client";

import { useState, useRef, useEffect } from "react";
import {
  Check,
  CheckCircle2,
  Paperclip,
  Wallet,
  CalendarDays,
  MapPin,
} from "lucide-react";
import CustomerLogo from "@/components/customer/Logo";
import { Field, Input, Textarea, Button, Banner } from "@/components/customer/Field";
import { ChoiceButton, NumberStepper } from "@/components/customer/atoms";
import DatePicker from "@/components/ui/DatePicker";
import { submitJobApplication } from "./actions/submitJobApplication";
import { uploadResume } from "./actions/uploadResume";

/* ------------------------------------------------------------------ */
/* Option sets — value stored in DB, en/fr labels shown to applicant   */
/* ------------------------------------------------------------------ */
const GENDERS = [
  { v: "Male", label: "Male · Homme" },
  { v: "Female", label: "Female · Femme" },
  { v: "Other", label: "Other · Autre" },
];

const DAYS = [
  { v: "Monday", label: "Mon · Lun" },
  { v: "Tuesday", label: "Tue · Mar" },
  { v: "Wednesday", label: "Wed · Mer" },
  { v: "Thursday", label: "Thu · Jeu" },
  { v: "Friday", label: "Fri · Ven" },
  { v: "Saturday", label: "Sat · Sam" },
  { v: "Sunday", label: "Sun · Dim" },
  { v: "Flexible", label: "Flexible" },
];

const HOURS = [
  { v: "Morning", label: "Morning (7am–12pm)", sub: "Matin" },
  { v: "Afternoon", label: "Afternoon (12pm–5pm)", sub: "Après-midi" },
  { v: "Flexible", label: "Flexible", sub: "N'importe quand" },
];

const EXP_TYPES = [
  { v: "Residential", label: "Residential · Résidentiel" },
  { v: "Commercial", label: "Commercial" },
  { v: "Move-in/Move-out", label: "Move-in / Move-out" },
  { v: "Post-construction", label: "Post-construction" },
  { v: "Airbnb", label: "Airbnb" },
  { v: "Restaurants", label: "Restaurants" },
  { v: "None", label: "None · Aucune" },
];

const HEAR = [
  { v: "Facebook", label: "Facebook" },
  { v: "Instagram", label: "Instagram" },
  { v: "Indeed", label: "Indeed" },
  { v: "Google", label: "Google" },
  { v: "Referral", label: "Referral · Référence" },
  { v: "Other", label: "Other · Autre" },
];

const COUNTRIES = [
  "Canada", "United States", "United Kingdom", "France", "Australia", "Germany",
  "India", "Ireland", "Italy", "Mexico", "Netherlands", "New Zealand", "Spain",
  "Portugal", "Brazil", "Argentina", "Belgium", "Switzerland", "Sweden", "Norway",
  "Denmark", "Finland", "Poland", "Philippines", "China", "Japan", "South Korea",
  "Nigeria", "Ghana", "Kenya", "South Africa", "Morocco", "Algeria", "Tunisia",
  "Egypt", "Lebanon", "Haiti", "Colombia", "Peru", "Chile", "Venezuela",
  "Dominican Republic", "Jamaica", "Pakistan", "Bangladesh", "Sri Lanka",
  "Vietnam", "Thailand", "Indonesia", "Ukraine", "Romania", "Russia", "Turkey",
  "Greece", "Austria", "Hungary", "Czech Republic", "Other",
];

/* Sidebar stepper labels + hints (bilingual). Order: contact first. */
const STEPS = [
  { label: "Contact", hint: "Vos coordonnées" },
  { label: "About you", hint: "À votre sujet" },
  { label: "Transportation", hint: "Transport" },
  { label: "Availability", hint: "Disponibilité" },
  { label: "Experience", hint: "Expérience" },
  { label: "A bit more", hint: "Un peu plus" },
  { label: "References & consent", hint: "Références" },
];

/* Per-step main header (cl-display headline split into [lead, emphasis] + bilingual subtitle) */
const HEADERS = [
  { head: ["Let's get to ", "know you."], sub: "Start with your contact details. · Vos coordonnées pour commencer." },
  { head: ["A few ", "details."], sub: "Tell us a bit about yourself. · Parlez-nous un peu de vous." },
  { head: ["Getting ", "around."], sub: "Transportation & insurance. · Transport et assurance." },
  { head: ["When can you ", "work?"], sub: "Your availability. · Vos disponibilités." },
  { head: ["Your ", "experience."], sub: "What you've done before. · Votre expérience." },
  { head: ["A little ", "more."], sub: "A few final questions. · Quelques dernières questions." },
  { head: ["Almost ", "done."], sub: "References & background consent. · Références et consentement." },
];

const todayISO = () => {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
};

const initialForm = {
  // Personal
  firstName: "",
  lastName: "",
  gender: "",
  dateOfBirth: "",
  addressStreet: "",
  addressLine2: "",
  cityArea: "",
  province: "",
  postalCode: "",
  country: "Canada",
  phone: "",
  email: "",
  // Transportation
  hasTransport: "" as "" | "yes" | "no",
  driversLicense: "",
  hasInsurance: "" as "" | "yes" | "no",
  insuranceDetails: "",
  // Availability
  availableDays: [] as string[],
  preferredHours: "",
  earliestStart: "",
  // Experience
  yearsExperience: "0",
  experienceTypes: [] as string[],
  experience: "",
  // About you
  whyCleano: "",
  hasConviction: "" as "" | "yes" | "no",
  convictionDetails: "",
  hearAbout: "",
  referrerName: "",
  // References
  ref1Name: "",
  ref1Relationship: "",
  ref1Phone: "",
  ref2Name: "",
  ref2Relationship: "",
  ref2Phone: "",
  // Consent
  backgroundConsent: false,
};

export default function CareersFormClient() {
  const [form, setForm] = useState(initialForm);
  const [consentDate, setConsentDate] = useState(todayISO());
  const [step, setStep] = useState(0);
  const [resumeUrl, setResumeUrl] = useState<string | null>(null);
  const [resumeName, setResumeName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isLast = step === STEPS.length - 1;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function toggle(k: "availableDays" | "experienceTypes", v: string) {
    setForm((f) => {
      const arr = f[k];
      return {
        ...f,
        [k]: arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v],
      };
    });
  }

  const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  function validateStep(s: number): string | null {
    if (s === 0) {
      if (!form.firstName.trim() || !form.lastName.trim())
        return "Please enter your first and last name.";
      if (!emailOk(form.email)) return "Please enter a valid email address.";
      if (!form.phone.trim()) return "Please enter a phone number.";
    }
    if (s === STEPS.length - 1 && !form.backgroundConsent) {
      return "Please consent to a background check to continue.";
    }
    return null;
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setResumeUrl(null);
    setResumeName(null);
    if (file.size > 8 * 1024 * 1024) {
      setUploading(false);
      setError("Résumé is too large — please keep it under 8MB.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await uploadResume(fd);
      if (res.success && res.url) {
        setResumeUrl(res.url);
        setResumeName(file.name);
      } else {
        setError(res.error ?? "Résumé upload failed.");
        if (fileRef.current) fileRef.current.value = "";
      }
    } catch {
      setError("Résumé upload failed — please try a smaller file or skip it.");
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setUploading(false);
    }
  }

  function next() {
    const err = validateStep(step);
    if (err) return setError(err);
    setError(null);
    if (isLast) {
      doSubmit();
      return;
    }
    setStep((s) => s + 1);
  }

  function back() {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  }

  async function doSubmit() {
    setSubmitting(true);
    setError(null);
    const res = await submitJobApplication({
      ...form,
      hasTransport: form.hasTransport === "" ? null : form.hasTransport === "yes",
      hasInsurance: form.hasInsurance === "" ? null : form.hasInsurance === "yes",
      hasConviction: form.hasConviction === "" ? null : form.hasConviction === "yes",
      consentDate,
      resumeUrl,
    });
    setSubmitting(false);
    if (res.success) setDone(true);
    else setError(res.error ?? "Something went wrong. Please try again.");
  }

  function resetForm() {
    setForm(initialForm);
    setConsentDate(todayISO());
    setStep(0);
    setResumeUrl(null);
    setResumeName(null);
    setError(null);
    setDone(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  const fullName = `${form.firstName} ${form.lastName}`.trim();

  return (
    <div className="cl-customer cl-careers">
      <div className="cl-book-shell">
        {/* ---------------- Sidebar ---------------- */}
        <aside className="cl-book-aside">
          <CustomerLogo onDark href="/" />

          <div className="cl-stack-8">
            <p
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "rgba(255,255,255,0.55)",
                fontWeight: 600,
                margin: 0,
              }}>
              Cleano Careers · Carrières
            </p>
            <h1
              style={{
                fontFamily: "var(--font-cl-serif)",
                fontSize: 30,
                color: "#fff",
                fontWeight: 300,
                letterSpacing: "-0.02em",
                lineHeight: 1.1,
                margin: 0,
              }}>
              {done ? "All done" : `Step ${step + 1} of ${STEPS.length}`}
            </h1>
          </div>

          <ol className="cl-vsteps" aria-label="Application progress">
            {STEPS.map((s, i) => {
              const cls =
                done || i < step
                  ? "cl-vstep done"
                  : i === step
                  ? "cl-vstep active"
                  : "cl-vstep";
              return (
                <li key={s.label} className={cls}>
                  <span className="cl-vstep-dot">
                    {done || i < step ? <Check size={14} strokeWidth={2.4} /> : i + 1}
                  </span>
                  <div className="cl-vstep-meta">
                    <span className="cl-vstep-label">{s.label}</span>
                    <span className="cl-vstep-hint">{s.hint}</span>
                  </div>
                </li>
              );
            })}
          </ol>

          {/* Selling block — perks in place of the booking price summary */}
          <div className="cl-summary">
            <span
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "rgba(255,255,255,0.6)",
                fontWeight: 600,
              }}>
              Why Cleano · Pourquoi Cleano
            </span>
            {[
              { icon: <Wallet size={15} />, t: "Competitive pay" },
              { icon: <CalendarDays size={15} />, t: "Flexible days" },
              { icon: <MapPin size={15} />, t: "Work near you" },
            ].map((p) => (
              <div
                key={p.t}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 13.5,
                  color: "rgba(255,255,255,0.85)",
                }}>
                <span style={{ color: "rgba(185,232,237,0.95)", display: "inline-flex" }}>
                  {p.icon}
                </span>
                {p.t}
              </div>
            ))}
          </div>

          <p
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.45)",
              lineHeight: 1.5,
              marginTop: "auto",
            }}>
            Takes about 3 minutes. We review every application and reach out by
            email or phone. · Environ 3 minutes.
          </p>
        </aside>

        {/* ---------------- Main ---------------- */}
        <main className="cl-book-main">
          <header className="cl-book-header cl-careers-header">
            <CustomerLogo href="/" />
            <span className="cl-careers-tagline">Join the Cleano team</span>
            {!done ? (
              <span className="cl-careers-mstep">
                Step {step + 1} / {STEPS.length}
              </span>
            ) : null}
          </header>

          {!done ? (
            <div className="cl-careers-mprogress" aria-hidden="true">
              <div
                className="cl-careers-mprogress-fill"
                style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
              />
            </div>
          ) : null}

          <div className="cl-book-body">
            {done ? (
              <div className="cl-stack-24 cl-fade-up" style={{ maxWidth: 540 }}>
                <header className="cl-stack-8">
                  <p className="cl-eyebrow">Application received · Reçue</p>
                  <h1 className="cl-display" style={{ fontSize: "clamp(34px, 4.4vw, 52px)" }}>
                    You&apos;re all <em>set, {form.firstName || "there"}.</em>
                  </h1>
                  <p className="cl-subtitle">
                    We&apos;ve received your application
                    {resumeName ? ` and your résumé (${resumeName})` : ""}. Expect to
                    hear from us at {form.email} within a few business days. · Merci !
                  </p>
                </header>

                <div className="cl-result-card ok">
                  <div className="cl-row" style={{ gap: 10 }}>
                    <CheckCircle2 size={22} />
                    <strong style={{ fontSize: 16 }}>Submitted successfully</strong>
                  </div>
                  <dl className="cl-dlist">
                    <SummaryRow dt="Name · Nom" dd={fullName} />
                    <SummaryRow dt="Email · Courriel" dd={form.email} />
                    <SummaryRow dt="Phone · Téléphone" dd={form.phone} />
                    {form.cityArea ? <SummaryRow dt="City · Ville" dd={form.cityArea} /> : null}
                  </dl>
                </div>

                <Button variant="secondary" onClick={resetForm}>
                  Submit another application
                </Button>
              </div>
            ) : (
              <>
                <div className="cl-fade-up" key={step}>
                  <header className="cl-stack-8" style={{ marginBottom: 28 }}>
                    <p className="cl-eyebrow">
                      Step {step + 1} of {STEPS.length} · Étape {step + 1}
                    </p>
                    <h1 className="cl-display" style={{ fontSize: "clamp(34px, 4.4vw, 52px)" }}>
                      {HEADERS[step].head[0]}
                      <em>{HEADERS[step].head[1]}</em>
                    </h1>
                    <p className="cl-subtitle">{HEADERS[step].sub}</p>
                  </header>

                  <div className="cl-stack-20">{renderStep()}</div>
                </div>

                {error ? (
                  <div style={{ marginTop: 24 }}>
                    <Banner kind="error">{error}</Banner>
                  </div>
                ) : null}

                <div
                  className="cl-careers-nav"
                  style={{
                    display: "flex",
                    gap: 12,
                    marginTop: 40,
                    paddingTop: 24,
                    borderTop: "1px solid var(--primary-10)",
                  }}>
                  {step > 0 ? (
                    <Button variant="ghost" onClick={back} disabled={submitting}>
                      ← Back
                    </Button>
                  ) : null}
                  <div style={{ flex: 1 }}>
                    <Button
                      size="lg"
                      block
                      onClick={next}
                      loading={submitting}
                      disabled={uploading}>
                      {isLast
                        ? submitting
                          ? "Submitting…"
                          : "Submit application · Soumettre"
                        : "Continue · Continuer →"}
                    </Button>
                  </div>
                </div>

                {isLast ? (
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--primary-50)",
                      lineHeight: 1.5,
                      marginTop: 16,
                      textAlign: "center",
                    }}>
                    By applying you agree to be contacted about employment
                    opportunities at Cleano. · En postulant, vous acceptez d&apos;être
                    contacté(e).
                  </p>
                ) : null}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );

  /* ---------------------------------------------------------------- */
  /* Step bodies                                                       */
  /* ---------------------------------------------------------------- */
  function renderStep() {
    switch (step) {
      case 0:
        return (
          <>
            <div className="cl-grid-2">
              <Field label="First name · Prénom *" htmlFor="fn">
                <Input
                  id="fn"
                  value={form.firstName}
                  onChange={(e) => set("firstName", e.target.value)}
                  placeholder="Jordan"
                />
              </Field>
              <Field label="Last name · Nom *" htmlFor="ln">
                <Input
                  id="ln"
                  value={form.lastName}
                  onChange={(e) => set("lastName", e.target.value)}
                  placeholder="Lévesque"
                />
              </Field>
            </div>
            <div className="cl-grid-2">
              <Field label="Phone · Téléphone *" htmlFor="ph">
                <Input
                  id="ph"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="(514) 555-0123"
                />
              </Field>
              <Field label="Email · Courriel *" htmlFor="em">
                <Input
                  id="em"
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="you@email.com"
                />
              </Field>
            </div>
            <Field label="City · Ville" htmlFor="city">
              <Input
                id="city"
                value={form.cityArea}
                onChange={(e) => set("cityArea", e.target.value)}
                placeholder="Montréal"
              />
            </Field>
          </>
        );

      case 1:
        return (
          <>
            <Group label="Gender · Genre">
              {GENDERS.map((g) => (
                <ChoiceButton
                  key={g.v}
                  active={form.gender === g.v}
                  title={g.label}
                  onClick={() => set("gender", g.v)}
                />
              ))}
            </Group>
            <Field label="Date of birth · Date de naissance">
              <DatePicker
                value={form.dateOfBirth}
                onChange={(v) => set("dateOfBirth", v)}
                max={todayISO()}
                placeholder="YYYY-MM-DD"
              />
            </Field>
            <Field label="Street address · Adresse" htmlFor="st">
              <Input
                id="st"
                value={form.addressStreet}
                onChange={(e) => set("addressStreet", e.target.value)}
                placeholder="123 Rue Saint-Denis"
              />
            </Field>
            <Field label="Apartment, suite, etc. · Appartement" htmlFor="l2">
              <Input
                id="l2"
                value={form.addressLine2}
                onChange={(e) => set("addressLine2", e.target.value)}
                placeholder="Apt 4"
              />
            </Field>
            <div className="cl-grid-2">
              <Field label="Province / State · Province" htmlFor="pv">
                <Input
                  id="pv"
                  value={form.province}
                  onChange={(e) => set("province", e.target.value)}
                  placeholder="QC"
                />
              </Field>
              <Field label="Postal code · Code postal" htmlFor="pc">
                <Input
                  id="pc"
                  value={form.postalCode}
                  onChange={(e) => set("postalCode", e.target.value)}
                  placeholder="H2X 1A1"
                />
              </Field>
            </div>
            <Field label="Country · Pays" htmlFor="co">
              <select
                id="co"
                className="cl-select"
                value={form.country}
                onChange={(e) => set("country", e.target.value)}>
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </>
        );

      case 2:
        return (
          <>
            <Group label="Do you have a reliable vehicle? · Véhicule fiable ?">
              <YesNo value={form.hasTransport} onChange={(v) => set("hasTransport", v)} />
            </Group>
            <Field label="Driver's licence number · Numéro de permis" htmlFor="dl">
              <Input
                id="dl"
                value={form.driversLicense}
                onChange={(e) => set("driversLicense", e.target.value)}
                placeholder="L1234-56789-01234"
              />
            </Field>
            <Group label="General liability insurance? · Assurance responsabilité ?">
              <YesNo value={form.hasInsurance} onChange={(v) => set("hasInsurance", v)} />
            </Group>
            <Field label="Insurance provider & policy number · Assureur et police" htmlFor="ins">
              <Input
                id="ins"
                value={form.insuranceDetails}
                onChange={(e) => set("insuranceDetails", e.target.value)}
                placeholder="Provider · Policy #"
              />
            </Field>
          </>
        );

      case 3:
        return (
          <>
            <Group label="Available days · Jours disponibles">
              {DAYS.map((d) => (
                <ChoiceButton
                  key={d.v}
                  active={form.availableDays.includes(d.v)}
                  title={d.label}
                  onClick={() => toggle("availableDays", d.v)}
                />
              ))}
            </Group>
            <Group label="Preferred hours · Heures préférées">
              {HOURS.map((h) => (
                <ChoiceButton
                  key={h.v}
                  large
                  active={form.preferredHours === h.v}
                  title={h.label}
                  sub={h.sub}
                  onClick={() => set("preferredHours", h.v)}
                />
              ))}
            </Group>
            <Field label="Earliest start date · Date de début">
              <DatePicker
                value={form.earliestStart}
                onChange={(v) => set("earliestStart", v)}
                min={todayISO()}
                placeholder="YYYY-MM-DD"
              />
            </Field>
          </>
        );

      case 4:
        return (
          <>
            <Field label="Years of cleaning experience · Années d'expérience">
              <NumberStepper
                label="Years · Années"
                value={Number(form.yearsExperience) || 0}
                onChange={(v) => set("yearsExperience", String(v))}
                min={0}
                max={40}
              />
            </Field>
            <Group label="Type of experience · Type d'expérience">
              {EXP_TYPES.map((t) => (
                <ChoiceButton
                  key={t.v}
                  active={form.experienceTypes.includes(t.v)}
                  title={t.label}
                  onClick={() => toggle("experienceTypes", t.v)}
                />
              ))}
            </Group>
            <Field label="Describe your experience · Décrivez votre expérience" htmlFor="exp">
              <Textarea
                id="exp"
                rows={3}
                value={form.experience}
                onChange={(e) => set("experience", e.target.value)}
                placeholder="Tell us about any relevant experience…"
              />
            </Field>
            <Field label="Résumé · CV">
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx"
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
                    <span className="cl-spinner" /> Uploading…
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
            </Field>
          </>
        );

      case 5:
        return (
          <>
            <Field label="Why do you want to work with Cleano? · Pourquoi Cleano ?" htmlFor="why">
              <Textarea
                id="why"
                rows={3}
                value={form.whyCleano}
                onChange={(e) => set("whyCleano", e.target.value)}
                placeholder="What draws you to this role?"
              />
            </Field>
            <Group label="Ever been convicted of a crime? · Déjà condamné(e) ?">
              <YesNo value={form.hasConviction} onChange={(v) => set("hasConviction", v)} />
            </Group>
            {form.hasConviction === "yes" ? (
              <Field label="If yes, please explain · Si oui, précisez" htmlFor="cd">
                <Textarea
                  id="cd"
                  rows={2}
                  value={form.convictionDetails}
                  onChange={(e) => set("convictionDetails", e.target.value)}
                  placeholder="Please provide details."
                />
              </Field>
            ) : null}
            <Group label="How did you hear about us? · Comment nous avez-vous connus ?">
              {HEAR.map((h) => (
                <ChoiceButton
                  key={h.v}
                  active={form.hearAbout === h.v}
                  title={h.label}
                  onClick={() => set("hearAbout", h.v)}
                />
              ))}
            </Group>
            {form.hearAbout === "Referral" ? (
              <Field label="Referrer's name · Nom du référent" htmlFor="ref">
                <Input
                  id="ref"
                  value={form.referrerName}
                  onChange={(e) => set("referrerName", e.target.value)}
                  placeholder="Who referred you?"
                />
              </Field>
            ) : null}
          </>
        );

      case 6:
        return (
          <>
            {([1, 2] as const).map((i) => {
              const nameK = `ref${i}Name` as const;
              const relK = `ref${i}Relationship` as const;
              const phoneK = `ref${i}Phone` as const;
              return (
                <div key={i} className="cl-card-soft cl-stack-12">
                  <span className="cl-label">
                    Reference {i} · Référence {i}
                  </span>
                  <Field label="Name · Nom" htmlFor={nameK}>
                    <Input
                      id={nameK}
                      value={form[nameK]}
                      onChange={(e) => set(nameK, e.target.value)}
                      placeholder="Full name"
                    />
                  </Field>
                  <div className="cl-grid-2">
                    <Field label="Relationship · Lien" htmlFor={relK}>
                      <Input
                        id={relK}
                        value={form[relK]}
                        onChange={(e) => set(relK, e.target.value)}
                        placeholder="Former manager…"
                      />
                    </Field>
                    <Field label="Phone · Téléphone" htmlFor={phoneK}>
                      <Input
                        id={phoneK}
                        type="tel"
                        value={form[phoneK]}
                        onChange={(e) => set(phoneK, e.target.value)}
                        placeholder="(514) 555-0123"
                      />
                    </Field>
                  </div>
                </div>
              );
            })}

            <label className="cl-addon-row" style={{ alignItems: "flex-start", gap: 12 }}>
              <input
                type="checkbox"
                className="cl-check"
                checked={form.backgroundConsent}
                onChange={(e) => set("backgroundConsent", e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span className="cl-addon-name" style={{ fontWeight: 400, lineHeight: 1.45 }}>
                I consent to a background check as part of this application. *
                <br />
                <span style={{ color: "var(--primary-60)", fontSize: 13 }}>
                  Je consens à une vérification des antécédents.
                </span>
              </span>
            </label>
            <Field label="Date">
              <DatePicker
                value={consentDate}
                onChange={setConsentDate}
                max={todayISO()}
                placeholder="YYYY-MM-DD"
              />
            </Field>
          </>
        );

      default:
        return null;
    }
  }
}

/* Label + grid of choice tiles (matches booking option groups) */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="cl-field">
      <span className="cl-label">{label}</span>
      <div className="cl-grid-2">{children}</div>
    </div>
  );
}

/* Yes / No tile pair (bilingual) */
function YesNo({
  value,
  onChange,
}: {
  value: "" | "yes" | "no";
  onChange: (v: "yes" | "no") => void;
}) {
  return (
    <>
      <ChoiceButton active={value === "yes"} title="Yes · Oui" onClick={() => onChange("yes")} />
      <ChoiceButton active={value === "no"} title="No · Non" onClick={() => onChange("no")} />
    </>
  );
}

function SummaryRow({ dt, dd }: { dt: string; dd: React.ReactNode }) {
  return (
    <div className="cl-dlist-row">
      <dt>{dt}</dt>
      <dd>{dd}</dd>
    </div>
  );
}

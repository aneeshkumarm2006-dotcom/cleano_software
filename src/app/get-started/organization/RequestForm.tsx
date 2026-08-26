"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

import {
  Banner,
  Button,
  Field,
  Input,
  Textarea,
} from "@/components/customer/Field";

import { submitAccessRequest } from "./actions";

/**
 * The Organization request form.
 *
 * Only three fields are required — company, contact, email — because every extra
 * required box on a form like this costs a conversation with a company that was
 * ready to have one. The rest makes the first reply better, and is optional.
 */
export default function RequestForm() {
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [fleetSize, setFleetSize] = useState("");
  const [wantedSlug, setWantedSlug] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");

  const [error, setError] = useState<{ field: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await submitAccessRequest({
        companyName,
        contactName,
        email,
        phone,
        fleetSize,
        wantedSlug,
        message,
        website,
      });
      if (r.ok) setSent(true);
      else setError({ field: r.field, message: r.message });
    } catch {
      setError({ field: "form", message: "Unexpected error. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <>
        <header style={{ marginBottom: 28 }}>
          <p className="cl-eyebrow" style={{ marginBottom: 12 }}>
            Received
          </p>
          <h1 className="cl-display">
            We have it, and
            <br />
            we will <em>reply.</em>
          </h1>
          <p className="cl-subtitle">
            Someone will read this properly rather than send you a template. Expect a real reply
            from a person at {companyName ? "Awer about " + companyName : "Awer"}.
          </p>
        </header>
        <Banner kind="success">
          We will write to <b>{email}</b>. If you think of something else, reply to that email
          rather than sending the form again.
        </Banner>
      </>
    );
  }

  return (
    <>
      <header style={{ marginBottom: 32 }}>
        <p className="cl-eyebrow" style={{ marginBottom: 12 }}>
          Organization plan
        </p>
        <h1 className="cl-display">
          Tell us about
          <br />
          your <em>company.</em>
        </h1>
        <p className="cl-subtitle">
          Above twenty cleaners the price depends on how you actually work — branches, crews,
          payroll, how much needs moving across. So it is a conversation, not a checkout.
        </p>
      </header>

      <form className="cl-stack-20" onSubmit={onSubmit} noValidate>
        <Field
          label="Company name"
          htmlFor="ar-company"
          error={error?.field === "company" ? error.message : undefined}
        >
          <Input
            id="ar-company"
            value={companyName}
            autoComplete="organization"
            placeholder="Brightpath Facility Group"
            onChange={(e) => {
              setCompanyName(e.target.value);
              setError(null);
            }}
          />
        </Field>

        <Field
          label="Your name"
          htmlFor="ar-contact"
          error={error?.field === "contact" ? error.message : undefined}
        >
          <Input
            id="ar-contact"
            value={contactName}
            autoComplete="name"
            placeholder="Renée Chartrand"
            onChange={(e) => {
              setContactName(e.target.value);
              setError(null);
            }}
          />
        </Field>

        <Field
          label="Email"
          htmlFor="ar-email"
          error={error?.field === "email" ? error.message : undefined}
        >
          <Input
            id="ar-email"
            type="email"
            value={email}
            autoComplete="email"
            placeholder="you@yourcompany.com"
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
          />
        </Field>

        <Field label="Phone" htmlFor="ar-phone" hint="Optional — often faster than email.">
          <Input
            id="ar-phone"
            type="tel"
            value={phone}
            autoComplete="tel"
            placeholder="+1 514 555 0142"
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>

        <Field
          label="How many cleaners"
          htmlFor="ar-fleet"
          hint="Optional. A rough number is fine — 'about 60, across four cities'."
        >
          <Input
            id="ar-fleet"
            value={fleetSize}
            placeholder="About 60"
            onChange={(e) => setFleetSize(e.target.value)}
          />
        </Field>

        <Field
          label="Address you would like"
          htmlFor="ar-slug"
          hint="Optional, and not reserved by asking — we will confirm it with you."
        >
          <Input
            id="ar-slug"
            value={wantedSlug}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="brightpath"
            onChange={(e) => setWantedSlug(e.target.value.toLowerCase())}
          />
        </Field>

        <Field
          label="What are you trying to fix"
          htmlFor="ar-message"
          hint="Optional, and the part we read first."
        >
          <Textarea
            id="ar-message"
            rows={4}
            value={message}
            placeholder="We run four branches on spreadsheets and WhatsApp. We need per-branch scheduling and one place to see cleaner hours."
            onChange={(e) => setMessage(e.target.value)}
          />
        </Field>

        {/* Hidden from people, filled in by scripts. Not display:none — some
            bots skip those — and kept out of the tab order and the a11y tree. */}
        <div
          aria-hidden="true"
          style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}
        >
          <label htmlFor="ar-website">Website</label>
          <input
            id="ar-website"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>

        {error?.field === "form" && <Banner kind="error">{error.message}</Banner>}

        <Button type="submit" variant="primary" block size="lg" loading={busy} disabled={busy}>
          {busy ? "Sending…" : "Send this to Awer"}
        </Button>

        <p className="cl-subtitle" style={{ fontSize: 12 }}>
          Twenty cleaners or fewer? You do not need us for that —{" "}
          <Link href="/get-started">start a free trial</Link> and be running today.
        </p>
      </form>
    </>
  );
}

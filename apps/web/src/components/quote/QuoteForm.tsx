"use client";

/**
 * The public quote-request form (item 18 · Q6).
 *
 * Two things changed from the 273-line literal version this replaces:
 *
 *  1. It LOOPS the admin-editable config instead of writing ten fields as
 *     static JSX. Copy, labels, help text, ordering, visibility, required-ness
 *     and per-service visibility all come from `quotePage.config`.
 *  2. The service dropdown reads THE service catalog (Settings → Job Types) and
 *     stores the canonical CATEGORY KEY, not free text — so switching a service
 *     off in Settings removes it from this form, which is the client's own
 *     worked example of what "editable from over here" means.
 *
 * It lives in `components/` rather than beside the route because the admin
 * Form tab mounts the very same component as its live preview. One renderer
 * means the preview cannot drift from the page — the failure mode a separate
 * mock-up of the form would have guaranteed.
 */

import { useMemo, useState, useTransition } from "react";
import { Field, Input, Textarea } from "@/components/customer/Field";
import { isValidEmail, isValidPhone } from "@/lib/validation";
import {
  isFullWidthQuoteField,
  visibleQuoteFields,
  type QuoteFieldConfig,
  type QuoteFieldKey,
  type QuotePageConfig,
} from "@/lib/quote-page-config";

export interface QuoteFormValues {
  name: string;
  email: string;
  phone: string;
  serviceType: string;
  address: string;
  bedCount: string;
  bathCount: string;
  squareFootage: string;
  preferredDate: string;
  message: string;
}

const EMPTY: QuoteFormValues = {
  name: "",
  email: "",
  phone: "",
  serviceType: "",
  address: "",
  bedCount: "",
  bathCount: "",
  squareFootage: "",
  preferredDate: "",
  message: "",
};

export type QuoteSubmit = (
  values: QuoteFormValues
) => Promise<{ success: boolean; error?: string }>;

interface Props {
  config: QuotePageConfig;
  /** Active services from the catalog: value = canonical category key. */
  services: { value: string; label: string }[];
  /** Renders when the config's eyebrow is blank, so the brand follows Settings. */
  brandName: string;
  /** Server action. Omitted in the admin preview, which never writes. */
  onSubmit?: QuoteSubmit;
  /** Preview mode: fully interactive, but submitting does nothing. */
  preview?: boolean;
  /** Force the success panel — the preview's "Success" toggle. */
  forceSuccess?: boolean;
}

/** Placeholders are presentation, not config — an admin edits label + help text. */
const PLACEHOLDERS: Partial<Record<QuoteFieldKey, string>> = {
  name: "Sarah Tremblay",
  email: "you@email.com",
  phone: "(514) 555-0142",
  address: "123 rue Sainte-Catherine, Montréal",
  message: "Special access instructions, pets, preferred products…",
};

export default function QuoteForm({
  config,
  services,
  brandName,
  onSubmit,
  preview = false,
  forceSuccess = false,
}: Props) {
  const [values, setValues] = useState<QuoteFormValues>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<QuoteFieldKey, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  // Per-service visibility keys off whatever the visitor has picked, so hiding
  // "Bedrooms" for Commercial takes effect the moment they choose Commercial.
  const fields = useMemo(
    () => visibleQuoteFields(config, values.serviceType || undefined),
    [config, values.serviceType]
  );

  function set(key: QuoteFieldKey, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }

  /**
   * Client-side mirror of the server's rule. `submitQuote` re-checks all of it —
   * this only saves the visitor a round trip, it is not the enforcement.
   */
  function validate(): Partial<Record<QuoteFieldKey, string>> {
    const next: Partial<Record<QuoteFieldKey, string>> = {};
    for (const f of fields) {
      const raw = values[f.key].trim();
      if (f.required && raw === "") {
        next[f.key] = `${f.label} is required.`;
        continue;
      }
      if (raw === "") continue;
      if (f.key === "email" && !isValidEmail(raw)) {
        next.email = "Enter a valid email address.";
      }
      if (f.key === "phone" && !isValidPhone(raw)) {
        next.phone = "Enter a valid 10-digit phone number.";
      }
    }
    return next;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    if (preview || !onSubmit) {
      // The preview is deliberately inert: an admin trying the form they are
      // editing must not file a real request into their own inbox.
      setDone(true);
      return;
    }

    startTransition(async () => {
      // Only what the form actually showed is sent. A field the admin hid can
      // never carry a stale value from before it was hidden.
      const payload = { ...EMPTY };
      for (const f of fields) payload[f.key] = values[f.key];

      const res = await onSubmit(payload);
      if (!res.success) {
        setFormError(res.error ?? "Could not submit");
        return;
      }
      setDone(true);
    });
  }

  const eyebrow = config.copy.eyebrow.trim() || brandName;

  if (done || forceSuccess) {
    return (
      <div className="cl-customer cl-stack-24">
        <QuoteSuccess
          title={config.copy.successTitle}
          body={config.copy.successBody}
        />
        {preview && (
          <PreviewNote>
            This is the confirmation panel. Nothing was submitted.
          </PreviewNote>
        )}
      </div>
    );
  }

  return (
    <div className="cl-customer cl-stack-24">
      <header className="cl-stack-8" style={{ textAlign: "center" }}>
        {eyebrow && <p className="cl-eyebrow">{eyebrow}</p>}
        <h1 className="cl-display" style={{ fontSize: "clamp(32px, 5vw, 48px)" }}>
          {config.copy.title}
        </h1>
        {config.copy.subhead && (
          <p className="cl-subtitle">{config.copy.subhead}</p>
        )}
      </header>

      <form onSubmit={handleSubmit} className="cl-tile" noValidate>
        <div className="cl-formgrid">
          {fields.map((f) => (
            <div
              key={f.key}
              className={isFullWidthQuoteField(f.key) ? "cl-formgrid-full" : undefined}>
              <QuoteField
                field={f}
                value={values[f.key]}
                error={errors[f.key]}
                services={services}
                onChange={(v) => set(f.key, v)}
              />
            </div>
          ))}
        </div>

        {formError && (
          <p
            role="alert"
            style={{
              marginTop: 16,
              color: "var(--error-text)",
              fontSize: 13,
              fontWeight: 600,
            }}>
            {formError}
          </p>
        )}

        <button
          type="submit"
          className="cl-btn cl-btn-primary cl-btn-block cl-btn-lg"
          style={{ marginTop: 20 }}
          disabled={pending}>
          <span>{pending ? "Sending…" : config.copy.submitLabel}</span>
        </button>
      </form>

      {preview && (
        <PreviewNote>
          Live preview — this is exactly what visitors see at <code>/quote</code>.
          Submitting here does nothing.
        </PreviewNote>
      )}
    </div>
  );
}

/* -------------------------------- pieces ---------------------------------- */

function QuoteField({
  field,
  value,
  error,
  services,
  onChange,
}: {
  field: QuoteFieldConfig;
  value: string;
  error?: string;
  services: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const id = `q-${field.key}`;
  const label = field.required ? `${field.label} *` : field.label;
  const common = {
    id,
    value,
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
    ) => onChange(e.target.value),
    "aria-invalid": !!error,
    placeholder: PLACEHOLDERS[field.key],
  };

  return (
    <Field
      label={label}
      htmlFor={id}
      error={error}
      hint={field.helpText || undefined}>
      {renderControl()}
    </Field>
  );

  function renderControl() {
    switch (field.key) {
      case "serviceType":
        return (
          <select
            id={id}
            className="cl-select"
            value={value}
            aria-invalid={!!error}
            onChange={(e) => onChange(e.target.value)}>
            <option value="">Select…</option>
            {services.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        );

      case "message":
        return <Textarea rows={4} error={!!error} {...common} />;

      case "bedCount":
      case "bathCount":
      case "squareFootage":
        return (
          <Input
            type="number"
            min={0}
            error={!!error}
            {...common}
            placeholder={field.key === "squareFootage" ? "e.g. 1200" : "0"}
          />
        );

      case "preferredDate":
        return <Input type="date" error={!!error} {...common} placeholder={undefined} />;

      case "email":
        return <Input type="email" autoComplete="email" error={!!error} {...common} />;

      case "phone":
        return <Input type="tel" autoComplete="tel" error={!!error} {...common} />;

      default:
        return <Input type="text" error={!!error} {...common} />;
    }
  }
}

function QuoteSuccess({ title, body }: { title: string; body: string }) {
  return (
    <div className="cl-tile" style={{ textAlign: "center" }}>
      <h2 className="cl-title-md" style={{ color: "var(--primary)", fontSize: 22 }}>
        {title}
      </h2>
      <p className="cl-subtitle" style={{ marginTop: 12 }}>
        {body}
      </p>
    </div>
  );
}

function PreviewNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 12.5,
        color: "var(--primary-60)",
        textAlign: "center",
        margin: 0,
      }}>
      {children}
    </p>
  );
}

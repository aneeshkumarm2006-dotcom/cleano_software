"use client";

import { BookingDraft } from "../types";
import { Field, Input, Textarea } from "@/components/customer/Field";
import { isValidEmail, isValidPhone } from "@/lib/validation";
import {
  BOOKING_PAGE_DEFAULTS,
  resolveVisibleFields,
  type BookingFieldConfig,
  type BookingPageConfig,
} from "@/lib/booking-page-config";

interface Props {
  draft: BookingDraft;
  onChange: (patch: Partial<BookingDraft>) => void;
  /** Admin-editable field layout (item 17). Defaults = today's rendering. */
  bookingPage?: BookingPageConfig;
}

const errorStyle: React.CSSProperties = {
  color: "#dc2626",
  fontSize: 13,
  marginTop: 4,
  display: "block",
};

/**
 * Fields narrow enough to sit two-up. Consecutive ones pair into a single row,
 * so the default order (email, phone / referral, promo) keeps today's layout
 * while an admin reordering them still gets something sensible.
 */
const NARROW_FIELDS = new Set(["email", "phone", "referralCode", "promoCode"]);

function groupFields(
  fields: BookingFieldConfig[]
): { pair: boolean; items: BookingFieldConfig[] }[] {
  const out: { pair: boolean; items: BookingFieldConfig[] }[] = [];
  for (const f of fields) {
    const narrow = NARROW_FIELDS.has(f.key);
    const last = out[out.length - 1];
    if (last && last.pair && narrow && last.items.length < 2) last.items.push(f);
    else out.push({ pair: narrow, items: [f] });
  }
  return out;
}

export default function Step4Contact({
  draft,
  onChange,
  bookingPage = BOOKING_PAGE_DEFAULTS,
}: Props) {
  const emailError = draft.email.trim() !== "" && !isValidEmail(draft.email);
  const phoneError = draft.phone.trim() !== "" && !isValidPhone(draft.phone);

  // Item 16 / decision D8: email and phone are the first two fields by default,
  // and the order is admin-editable rather than baked in here.
  const fields = resolveVisibleFields(bookingPage, "contact", draft.serviceType);
  const blocks = groupFields(fields);

  // Autofocus goes to whichever field leads the step, not always the name.
  const firstKey = fields[0]?.key;

  function renderField(f: BookingFieldConfig) {
    switch (f.key) {
      case "name":
        return (
          <Field key={f.key} label={f.label} htmlFor="c-name" hint={f.helpText || undefined}>
            <Input
              id="c-name"
              value={draft.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="Sarah Tremblay"
              autoFocus={firstKey === "name"}
            />
          </Field>
        );

      case "email":
        return (
          <Field key={f.key} label={f.label} htmlFor="c-email" hint={f.helpText || undefined}>
            <Input
              id="c-email"
              type="email"
              value={draft.email}
              onChange={(e) => onChange({ email: e.target.value })}
              placeholder="you@email.com"
              aria-invalid={emailError}
              autoFocus={firstKey === "email"}
            />
            {emailError && (
              <span style={errorStyle}>Enter a valid email address.</span>
            )}
          </Field>
        );

      case "phone":
        return (
          <Field key={f.key} label={f.label} htmlFor="c-phone" hint={f.helpText || undefined}>
            <Input
              id="c-phone"
              type="tel"
              value={draft.phone}
              onChange={(e) => onChange({ phone: e.target.value })}
              placeholder="(514) 555-0142"
              aria-invalid={phoneError}
              autoFocus={firstKey === "phone"}
            />
            {phoneError && (
              <span style={errorStyle}>Enter a valid 10-digit phone number.</span>
            )}
          </Field>
        );

      case "notes":
        return (
          <Field key={f.key} label={f.label} htmlFor="c-notes" hint={f.helpText || undefined}>
            <Textarea
              id="c-notes"
              rows={3}
              value={draft.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
              placeholder="Pets, parking, door codes, sensitive surfaces…"
            />
          </Field>
        );

      case "referralCode":
        return (
          <Field key={f.key} label={f.label} htmlFor="c-ref" hint={f.helpText || undefined}>
            <input
              id="c-ref"
              className="cl-input mono"
              value={draft.referralCode}
              onChange={(e) =>
                onChange({ referralCode: e.target.value.toUpperCase() })
              }
              placeholder="Enter your code"
              maxLength={16}
            />
          </Field>
        );

      case "promoCode":
        return (
          <Field key={f.key} label={f.label} htmlFor="c-promo" hint={f.helpText || undefined}>
            <input
              id="c-promo"
              className="cl-input mono"
              value={draft.promoCode ?? ""}
              onChange={(e) =>
                onChange({
                  promoCode: e.target.value.toUpperCase(),
                  promoDiscount: 0,
                  promoApplied: false,
                })
              }
              placeholder="SUMMER20"
              maxLength={24}
            />
          </Field>
        );

      case "smsConsent":
        return (
          <label
            key={f.key}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              marginTop: 16,
              fontSize: 13,
              lineHeight: 1.5,
              cursor: "pointer",
            }}>
            <input
              type="checkbox"
              checked={draft.smsConsent}
              onChange={(e) => onChange({ smsConsent: e.target.checked })}
              style={{ marginTop: 2 }}
            />
            <span>{f.label}</span>
          </label>
        );

      default:
        return null;
    }
  }

  return (
    <div className="cl-stack-32">
      <header className="cl-stack-8">
        <p className="cl-eyebrow">Step 4</p>
        <h1
          className="cl-display"
          style={{ fontSize: "clamp(34px, 4.4vw, 52px)" }}>
          How can we
          <br />
          reach <em>you?</em>
        </h1>
        <p className="cl-subtitle">
          We&rsquo;ll send a confirmation and a reminder before your
          appointment.
        </p>
      </header>

      {/* Field list, order and labels all come from the admin-editable booking
          page config (item 17). Adjacent narrow fields pair into one row. */}
      {blocks.map((block, bi) => {
        const nodes = block.items.map(renderField).filter(Boolean);
        if (nodes.length === 0) return null;
        if (block.pair && nodes.length > 1) {
          return (
            <div key={`row-${bi}`} className="cl-grid-2">
              {nodes}
            </div>
          );
        }
        return <div key={block.items[0].key}>{nodes}</div>;
      })}
    </div>
  );
}

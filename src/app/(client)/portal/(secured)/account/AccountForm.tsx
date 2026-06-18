"use client";

import { useState, FormEvent } from "react";
import { Sparkles } from "lucide-react";
import {
  Field,
  Input,
  Button,
  Banner,
} from "@/components/customer/Field";
import { updateClientProfile } from "../../actions/updateClientProfile";

interface Initial {
  name: string;
  email: string;
  phone: string;
  address: string;
  referralCode: string | null;
  referralCredit: number;
}

function formatPrice(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function AccountForm({
  initial,
  businessEmail,
  businessPhone,
}: {
  initial: Initial;
  businessEmail: string;
  businessPhone: string;
}) {
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [address, setAddress] = useState(initial.address);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const dirty =
    name !== initial.name ||
    phone !== initial.phone ||
    address !== initial.address;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setSaving(true);
    setFlash(null);
    const res = await updateClientProfile({ name, phone, address });
    setSaving(false);
    setFlash(
      res.success
        ? { kind: "success", text: "Saved. Your account is up to date." }
        : { kind: "error", text: res.error || "Couldn't save" }
    );
  }

  function copyCode() {
    if (!initial.referralCode) return;
    if (navigator.clipboard)
      navigator.clipboard.writeText(initial.referralCode);
    setFlash({ kind: "success", text: "Referral code copied." });
    setTimeout(() => setFlash(null), 2200);
  }

  return (
    <>
      <header className="cl-stack-8" style={{ marginBottom: 36 }}>
        <p className="cl-eyebrow">Account</p>
        <h1
          className="cl-display"
          style={{ fontSize: "clamp(34px, 4.2vw, 48px)" }}>
          Your <em>details.</em>
        </h1>
        <p className="cl-subtitle" style={{ fontSize: 15 }}>
          Keep your contact info current so we can reach you about cleanings.
        </p>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 360px",
          gap: 24,
          alignItems: "flex-start",
        }}
        className="cl-account-grid">
        <div className="cl-tile cl-tile-pad-lg">
          <h2 className="cl-title-md" style={{ marginBottom: 24 }}>
            Profile
          </h2>
          <form className="cl-stack-20" onSubmit={onSubmit}>
            <Field label="Name" htmlFor="acct-name">
              <Input
                id="acct-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <Field
              label="Email"
              htmlFor="acct-email"
              hint="Email is your login — contact us to change it.">
              <Input
                id="acct-email"
                value={initial.email}
                disabled
                style={{ opacity: 0.6 }}
              />
            </Field>

            <Field label="Phone" htmlFor="acct-phone">
              <Input
                id="acct-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>

            <Field label="Default address" htmlFor="acct-address">
              <Input
                id="acct-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </Field>

            {flash ? <Banner kind={flash.kind}>{flash.text}</Banner> : null}

            <div>
              <Button type="submit" loading={saving} disabled={!dirty}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
        </div>

        <div className="cl-stack-16">
          <div
            className="cl-tile cl-tile-pad-lg"
            style={{
              background:
                "linear-gradient(160deg, var(--primary-deep) 0%, var(--primary) 100%)",
              color: "#fff",
            }}>
            <span
              className="cl-label"
              style={{ color: "rgba(255,255,255,0.65)" }}>
              Referral
            </span>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                margin: "14px 0",
              }}>
              <div
                style={{
                  fontFamily: "var(--font-cl-mono)",
                  fontSize: 22,
                  letterSpacing: "0.1em",
                  color: "#fff",
                  fontWeight: 500,
                }}>
                {initial.referralCode ?? "—"}
              </div>
              {initial.referralCode ? (
                <button
                  className="cl-icon-btn"
                  style={{
                    background: "rgba(255,255,255,0.1)",
                    color: "#fff",
                    width: 36,
                    height: 36,
                  }}
                  onClick={copyCode}
                  aria-label="Copy referral code">
                  <Sparkles size={16} />
                </button>
              ) : null}
            </div>
            <p
              style={{
                fontSize: 13,
                color: "rgba(255,255,255,0.78)",
                margin: 0,
                lineHeight: 1.55,
              }}>
              They get <strong>$15 off</strong> their first booking, and you
              get <strong>$10 credit</strong> when they book.
            </p>
            <div
              style={{
                marginTop: 18,
                paddingTop: 16,
                borderTop: "1px solid rgba(255,255,255,0.15)",
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
              }}>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>
                Available credit
              </span>
              <span
                style={{
                  fontFamily: "var(--font-cl-serif)",
                  fontSize: 24,
                  color: "#fff",
                  fontWeight: 500,
                }}>
                {formatPrice(initial.referralCredit)}
              </span>
            </div>
          </div>

          <div className="cl-tile cl-tile-pad-sm">
            <h3 className="cl-title-md" style={{ marginBottom: 8 }}>
              Need help?
            </h3>
            <p
              style={{
                fontSize: 13,
                color: "var(--primary-70)",
                margin: 0,
                lineHeight: 1.55,
              }}>
              Email{" "}
              <a className="cl-link" href={`mailto:${businessEmail}`}>
                {businessEmail}
              </a>{" "}
              or text us at{" "}
              <a className="cl-link" href={`tel:${businessPhone.replace(/[^\d+]/g, "")}`}>
                {businessPhone}
              </a>
              . We answer within an hour, 7 days.
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .cl-account-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </>
  );
}

"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, Check } from "lucide-react";
import { BookingDraft } from "../types";
import { Input, Button, Banner } from "@/components/customer/Field";
import { checkServiceArea } from "../../actions/checkServiceArea";
import { saveLead } from "../../actions/saveLead";
import {
  BOOKING_PAGE_DEFAULTS,
  resolveField,
  type BookingPageConfig,
} from "@/lib/booking-page-config";

interface Props {
  draft: BookingDraft;
  onChange: (patch: Partial<BookingDraft>) => void;
  onContinue: () => void;
  /** Admin-editable field layout (item 17). Defaults = today's rendering. */
  bookingPage?: BookingPageConfig;
}

export default function Step1PostalCode({
  draft,
  onChange,
  onContinue,
  bookingPage = BOOKING_PAGE_DEFAULTS,
}: Props) {
  const postalField = resolveField(bookingPage, "postal", "postalCode");
  const [checking, setChecking] = useState(false);
  const [leadEmail, setLeadEmail] = useState("");
  const [leadCaptured, setLeadCaptured] = useState(false);
  const [savingLead, setSavingLead] = useState(false);

  async function handleCheck() {
    if (!draft.postalCode.trim()) return;
    setChecking(true);
    const res = await checkServiceArea(draft.postalCode);
    setChecking(false);
    if ("error" in res && res.error) return;
    const covered = "covered" in res ? res.covered : false;
    const zoneName = "zoneName" in res ? res.zoneName ?? null : null;
    const travelFee = "travelFee" in res ? res.travelFee ?? 0 : 0;
    onChange({ postalCovered: covered, zoneName, travelFee });
  }

  async function handleCaptureLead() {
    if (!leadEmail.includes("@")) return;
    setSavingLead(true);
    await saveLead({
      email: leadEmail,
      postalCode: draft.postalCode,
      dropOffStep: 1,
      outOfArea: true,
    });
    setSavingLead(false);
    setLeadCaptured(true);
  }

  return (
    <div className="cl-stack-32">
      <header className="cl-stack-8">
        <p className="cl-eyebrow">Step 1</p>
        <h1
          className="cl-display"
          style={{ fontSize: "clamp(34px, 4.4vw, 52px)" }}>
          Let's see if we
          <br />
          cover <em>your area.</em>
        </h1>
        <p className="cl-subtitle">Enter your postal code to get started.</p>
      </header>

      <div className="cl-stack-12">
        <span className="cl-label">{postalField?.label ?? "Postal code"}</span>
        {postalField?.helpText ? (
          <p style={{ fontSize: 12, color: "var(--primary-60)", margin: 0, lineHeight: 1.5 }}>
            {postalField.helpText}
          </p>
        ) : null}
        <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
          <Input
            className="mono"
            placeholder="H1A 2B3"
            maxLength={7}
            value={draft.postalCode}
            onChange={(e) =>
              onChange({
                postalCode: e.target.value.toUpperCase(),
                postalCovered: null,
              })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCheck();
              }
            }}
            style={{ flex: 1, fontSize: 17 }}
            aria-label={postalField?.label ?? "Postal code"}
          />
          <Button
            size="lg"
            onClick={handleCheck}
            loading={checking}
            disabled={!draft.postalCode || checking}
            style={{ minWidth: 110 }}>
            {checking ? "…" : "Check"}
          </Button>
        </div>
      </div>

      {draft.postalCovered === true ? (
        <div className="cl-result-card ok">
          <div className="cl-row" style={{ gap: 10 }}>
            <CheckCircle2 size={22} />
            <strong style={{ fontSize: 16 }}>
              Great — we serve {draft.zoneName ?? "your area"}.
            </strong>
          </div>
          <div style={{ fontSize: 13, color: "var(--emerald-800)" }}>
            {draft.travelFee > 0
              ? `A $${draft.travelFee.toFixed(2)} travel fee applies for this zone.`
              : "No travel fee for this zone."}
          </div>
          <Button size="lg" block onClick={onContinue}>
            Continue →
          </Button>
        </div>
      ) : null}

      {draft.postalCovered === false ? (
        leadCaptured ? (
          <div className="cl-result-card ok">
            <div className="cl-row" style={{ gap: 10 }}>
              <Check size={20} />
              <strong>Got it — we'll be in touch.</strong>
            </div>
          </div>
        ) : (
          <div className="cl-result-card warn">
            <div className="cl-row" style={{ gap: 10 }}>
              <XCircle size={22} />
              <strong style={{ fontSize: 16 }}>
                We're not in your area yet.
              </strong>
            </div>
            <div style={{ fontSize: 13 }}>
              Leave your email and we'll let you know when we expand.
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCaptureLead();
              }}
              style={{ display: "flex", gap: 8 }}>
              <Input
                type="email"
                placeholder="you@email.com"
                value={leadEmail}
                onChange={(e) => setLeadEmail(e.target.value)}
                style={{ flex: 1 }}
              />
              <Button
                variant="amber"
                type="submit"
                loading={savingLead}>
                Notify me
              </Button>
            </form>
          </div>
        )
      ) : null}

      <div style={{ fontSize: 12, color: "var(--primary-50)" }}>
        Try <code>H2X 1Y4</code> (downtown), <code>H1V 1A1</code> (travel fee),
        or <code>K1A 0B1</code> (out of area).
      </div>
    </div>
  );
}

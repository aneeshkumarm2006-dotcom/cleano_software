"use client";

import Input from "@/components/ui/Input";
import { ShoppingCart, MapPin, Package } from "lucide-react";

interface SummaryItem {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
}

interface CheckoutSummaryProps {
  locationName: string;
  locationAddress: string | null;
  items: SummaryItem[];
  notes: string;
  onNotesChange: (val: string) => void;
  onConfirm: () => void;
  onBack: () => void;
  submitting: boolean;
}

export default function CheckoutSummary({
  locationName,
  locationAddress,
  items,
  notes,
  onNotesChange,
  onConfirm,
  onBack,
  submitting,
}: CheckoutSummaryProps) {
  const totalItems = items.length;
  const totalUnits = items.reduce((acc, i) => acc + i.quantity, 0);

  return (
    <div className="cl-co-section">
      <h2>
        <ShoppingCart className="w-5 h-5" />
        Review &amp; confirm
      </h2>

      <div className="cl-co-summary-loc">
        <MapPin className="w-4 h-4" style={{ color: "var(--primary)", marginTop: 2 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--primary-deep)" }}>
            {locationName}
          </div>
          {locationAddress && (
            <div style={{ fontSize: 12, color: "var(--primary-50)", marginTop: 2 }}>
              {locationAddress}
            </div>
          )}
        </div>
      </div>

      <div>
        <p
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--primary-60)",
            margin: "0 0 8px",
          }}>
          Items ({totalItems})
        </p>
        <div className="cl-co-summary-list">
          {items.map((i) => (
            <div key={i.productId} className="cl-co-summary-item">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Package className="w-4 h-4" style={{ color: "var(--primary-50)" }} />
                <span>{i.productName}</span>
              </span>
              <span style={{ color: "var(--primary-60)", fontVariantNumeric: "tabular-nums" }}>
                {i.quantity} {i.unit}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <label
          style={{
            display: "block",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--primary-60)",
            marginBottom: 8,
          }}>
          Pickup notes (optional)
        </label>
        <Input
          variant="form"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="e.g. Picking up before 8am job"
        />
      </div>

      <div className="cl-co-summary-foot">
        <span style={{ color: "var(--primary-60)" }}>Total units</span>
        <span className="total" style={{ fontVariantNumeric: "tabular-nums" }}>
          {totalUnits.toFixed(2)}
        </span>
      </div>

      <div className="cl-co-actions">
        <button
          type="button"
          className="cl-co-btn-ghost"
          onClick={onBack}
          disabled={submitting}>
          Back
        </button>
        <button
          type="button"
          className="cl-co-btn-confirm"
          onClick={onConfirm}
          disabled={submitting || items.length === 0}>
          {submitting ? "Processing…" : "Confirm pickup"}
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Copy, Check, Navigation } from "lucide-react";
import { formatAddressCopy, formatAddressQuery } from "@/lib/client-address";

/**
 * ROUND 4, FIX 7. This used to take one prop — `job.location`, the raw string —
 * which made both of its jobs wrong at once:
 *
 *   • COPY pasted whatever the string happened to hold, so a job whose unit,
 *     city and postal code live in columns copied a bare street, and a job
 *     whose unit rides at the tail copied a trailing number nobody reads as an
 *     apartment. The PDF asks for the apartment to be IN the copied address.
 *   • The NAVIGATION links passed that same string to the geocoders, unit and
 *     all — and a unit in the query is the thing that makes Google, Apple and
 *     Waze worse at finding the building.
 *
 * Structured props settle both: the copy is assembled with the unit labelled,
 * the deep links are assembled without it. Neither has to guess.
 */
export default function MapLinks({
  street,
  apt,
  city,
  postalCode,
}: {
  street: string;
  apt?: string | null;
  city?: string | null;
  postalCode?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const parts = { address: street, aptNumber: apt, city, postalCode };
  const copyText = formatAddressCopy(parts);
  const encoded = encodeURIComponent(formatAddressQuery(parts));

  function handleCopy() {
    navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // These sit on the DARK job-detail hero. They were previously teal (#008C9C)
  // and green (#00a868) on a near-transparent fill — colours picked for a white
  // card — which left the labels barely legible against the dark gradient, and
  // unreadable outdoors. White on a translucent white fill reads cleanly on the
  // hero at any brightness. Sizes also bumped: 12px text in a 6px-tall pill was
  // well under a comfortable touch target for the app's most urgent action
  // (navigating to the job).
  const base: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
    padding: "10px 14px", minHeight: 40, borderRadius: 10,
    fontSize: 13, fontWeight: 600, letterSpacing: "0.01em",
    textDecoration: "none", border: "1px solid rgba(255,255,255,0.28)",
    color: "#ffffff", background: "rgba(255,255,255,0.14)", whiteSpace: "nowrap",
    WebkitTapHighlightColor: "transparent", touchAction: "manipulation",
  };

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, marginBottom: 4 }}>
      <a
        href={`https://waze.com/ul?q=${encoded}&navigate=yes`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ ...base, borderColor: "rgba(120,255,190,0.45)", background: "rgba(0,200,120,0.22)" }}
      >
        <Navigation size={14} /> Waze
      </a>
      <a
        href={`https://maps.google.com/?q=${encoded}`}
        target="_blank"
        rel="noopener noreferrer"
        style={base}
      >
        <Navigation size={14} /> Google Maps
      </a>
      <a
        href={`https://maps.apple.com/?q=${encoded}`}
        target="_blank"
        rel="noopener noreferrer"
        style={base}
      >
        <Navigation size={14} /> Apple Maps
      </a>
      <button
        type="button"
        onClick={handleCopy}
        style={{
          ...base, cursor: "pointer",
          background: copied ? "rgba(16,220,140,0.28)" : "rgba(255,255,255,0.14)",
          borderColor: copied ? "rgba(120,255,190,0.5)" : "rgba(255,255,255,0.28)",
          // Stays white in both states — the old teal/green was picked for a
          // white card and vanished against the dark hero.
          color: "#ffffff",
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

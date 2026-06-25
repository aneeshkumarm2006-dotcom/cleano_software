"use client";

import { useState } from "react";
import { Copy, Check, Navigation } from "lucide-react";

export default function MapLinks({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const encoded = encodeURIComponent(address);

  function handleCopy() {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const base: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 5,
    padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 500,
    textDecoration: "none", border: "1px solid rgba(0,140,156,0.2)",
    color: "#008C9C", background: "rgba(0,140,156,0.05)", whiteSpace: "nowrap",
  };

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, marginBottom: 4 }}>
      <a
        href={`https://waze.com/ul?q=${encoded}&navigate=yes`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ ...base, borderColor: "rgba(0,168,104,0.3)", color: "#00a868", background: "rgba(0,168,104,0.06)" }}
      >
        <Navigation size={11} /> Waze
      </a>
      <a
        href={`https://maps.google.com/?q=${encoded}`}
        target="_blank"
        rel="noopener noreferrer"
        style={base}
      >
        <Navigation size={11} /> Google Maps
      </a>
      <a
        href={`https://maps.apple.com/?q=${encoded}`}
        target="_blank"
        rel="noopener noreferrer"
        style={base}
      >
        <Navigation size={11} /> Apple Maps
      </a>
      <button
        type="button"
        onClick={handleCopy}
        style={{
          ...base, cursor: "pointer",
          background: copied ? "rgba(5,150,105,0.1)" : "rgba(0,140,156,0.05)",
          borderColor: copied ? "rgba(5,150,105,0.3)" : "rgba(0,140,156,0.2)",
          color: copied ? "#059669" : "#008C9C",
        }}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

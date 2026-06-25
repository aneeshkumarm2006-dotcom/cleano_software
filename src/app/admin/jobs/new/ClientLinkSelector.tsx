"use client";

import { useState } from "react";
import PremiumSelect from "@/components/ui/PremiumSelect";
import SaveCardOnFile from "../SaveCardOnFile";

interface ClientOption {
  id: string;
  name: string;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  defaultPaymentMethodId?: string | null;
}

interface ClientLinkSelectorProps {
  clients: ClientOption[];
  defaultValue?: string;
}

export default function ClientLinkSelector({
  clients,
  defaultValue,
}: ClientLinkSelectorProps) {
  const [value, setValue] = useState(defaultValue || "");
  const [cardSavedNow, setCardSavedNow] = useState(false);

  const selectedClient = clients.find((c) => c.id === value) ?? null;

  const setInputValue = (name: string, val: string) => {
    const el = document.querySelector(
      `input[name="${name}"]`
    ) as HTMLInputElement | null;
    if (el) {
      el.value = val;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  const options = [
    { value: "", label: "— None —" },
    ...clients.map((c) => ({
      value: c.id,
      label: c.name,
      description: [c.email, c.phone].filter(Boolean).join(" · ") || undefined,
      keywords: [c.email, c.phone].filter(Boolean).join(" "),
    })),
  ];

  return (
    <>
      <PremiumSelect
        name="clientId"
        value={value}
        onChange={(v) => {
          setValue(v);
          setCardSavedNow(false);
          const c = clients.find((cl) => cl.id === v);
          if (!c) return;
          setInputValue("clientName", c.name);
          setInputValue("location", c.address || "");
        }}
        options={options}
        placeholder="Search by name, email or phone…"
        searchable
        size="md"
      />

      {/* Card on file — admin can enter the client's card now and we'll
          charge it after the job. Requires an existing (saved) client. */}
      {selectedClient &&
        (selectedClient.defaultPaymentMethodId || cardSavedNow ? (
          <div
            style={{
              marginTop: 12,
              padding: "8px 12px",
              background: "#dcfce7",
              color: "#166534",
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 8,
            }}>
            ✓ Card on file. Charges will run off-session.
          </div>
        ) : (
          <SaveCardOnFile
            clientId={selectedClient.id}
            clientName={selectedClient.name}
            clientEmail={selectedClient.email ?? null}
            onSaved={() => setCardSavedNow(true)}
          />
        ))}
    </>
  );
}

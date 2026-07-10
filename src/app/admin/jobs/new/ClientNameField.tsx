"use client";

// Client name field with live search over existing customers. Typing searches
// the saved client list by name / email / phone; picking one links the job
// (hidden clientId), fills email + phone, and lets the admin pick among the
// client's saved addresses (or type a new one). Free text is still allowed for a
// brand-new customer — saveJob creates the Client profile from the entered
// name / email / phone / address on submit.

import { useEffect, useRef, useState } from "react";
import Input from "@/components/ui/Input";
import PremiumSelect from "@/components/ui/PremiumSelect";
import SaveCardOnFile from "../SaveCardOnFile";

interface ClientAddressOption {
  id: string;
  label: string;
  address: string;
  aptNumber?: string | null;
  isDefault: boolean;
}

interface ClientOption {
  id: string;
  name: string;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  aptNumber?: string | null;
  discountPercent?: number | null;
  fixedPrice?: number | null;
  defaultPaymentMethodId?: string | null;
  addresses?: ClientAddressOption[];
}

const NEW_ADDRESS = "__new__";

export default function ClientNameField({
  clients,
  defaultName,
  defaultClientId,
}: {
  clients: ClientOption[];
  defaultName?: string;
  defaultClientId?: string;
}) {
  const initialClient = clients.find((c) => c.id === defaultClientId) ?? null;

  const [name, setName] = useState(defaultName ?? "");
  const [clientId, setClientId] = useState(defaultClientId ?? "");
  const [email, setEmail] = useState(initialClient?.email ?? "");
  const [phone, setPhone] = useState(initialClient?.phone ?? "");
  const [addressChoice, setAddressChoice] = useState<string>(NEW_ADDRESS);
  const [open, setOpen] = useState(false);
  const [cardSavedNow, setCardSavedNow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = clients.find((c) => c.id === clientId) ?? null;
  const savedAddresses = selected?.addresses ?? [];

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  // Fill a sibling field on the form by name (location / apt live elsewhere).
  const setField = (field: string, val: string) => {
    const el = document.querySelector(
      `input[name="${field}"]`
    ) as HTMLInputElement | null;
    if (el) {
      el.value = val;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  const q = name.trim().toLowerCase();
  const matches =
    q.length === 0
      ? []
      : clients
          .filter((c) => {
            if (c.id === clientId) return false; // already linked
            const hay = [c.name, c.email, c.phone]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();
            return hay.includes(q);
          })
          .slice(0, 8);

  function fillAddress(addr: ClientAddressOption) {
    setField("location", addr.address || "");
    setField("aptNumber", addr.aptNumber || "");
  }

  function pick(c: ClientOption) {
    setName(c.name);
    setClientId(c.id);
    setEmail(c.email ?? "");
    setPhone(c.phone ?? "");
    setCardSavedNow(false);

    // Prefer a saved default address; fall back to the legacy Client.address.
    const list = c.addresses ?? [];
    const def = list.find((a) => a.isDefault) ?? list[0] ?? null;
    if (def) {
      setAddressChoice(def.id);
      fillAddress(def);
    } else {
      setAddressChoice(NEW_ADDRESS);
      setField("location", c.address || "");
      setField("aptNumber", c.aptNumber || "");
    }

    // Fixed-price client: pre-fill the price with their agreed total, but
    // never clobber a price the admin already typed.
    if ((c.fixedPrice ?? 0) > 0) {
      const priceEl = document.querySelector(
        'input[name="price"]'
      ) as HTMLInputElement | null;
      if (priceEl && !priceEl.value) {
        setField("price", String(c.fixedPrice));
      }
    }
    setOpen(false);
  }

  function onAddressChoice(v: string) {
    setAddressChoice(v);
    if (v === NEW_ADDRESS) {
      // Let the admin type a fresh address into the Location / Apt fields.
      setField("location", "");
      setField("aptNumber", "");
      return;
    }
    const addr = savedAddresses.find((a) => a.id === v);
    if (addr) fillAddress(addr);
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input type="hidden" name="clientId" value={clientId} />
      <Input
        type="text"
        id="clientName"
        name="clientName"
        required
        autoComplete="off"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setClientId(""); // editing the name detaches from the saved client
          setCardSavedNow(false);
          setAddressChoice(NEW_ADDRESS);
          setOpen(true);
        }}
        onFocus={() => {
          if (name.trim()) setOpen(true);
        }}
        placeholder="Start typing to search existing customers…"
      />

      {open && matches.length > 0 && (
        <div className="client-typeahead">
          {matches.map((c) => (
            <button
              type="button"
              key={c.id}
              className="client-typeahead-row"
              onClick={() => pick(c)}>
              <span className="client-typeahead-name">{c.name}</span>
              {(c.email || c.phone) && (
                <span className="client-typeahead-sub">
                  {[c.email, c.phone].filter(Boolean).join(" · ")}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="client-typeahead-linked">
          ✓ Linked to saved customer
          {(selected.fixedPrice ?? 0) > 0
            ? ` · Fixed price $${selected.fixedPrice!.toFixed(2)}`
            : ""}
        </div>
      )}

      {/* Contact — filled from the linked client, editable, and used to create
          the Client profile for a brand-new (unlinked) customer. */}
      <div className="cnf-contact-grid">
        <div>
          <label className="cnf-sub-label">Email</label>
          <Input
            type="email"
            name="clientEmail"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
          />
        </div>
        <div>
          <label className="cnf-sub-label">Phone</label>
          <Input
            type="tel"
            name="clientPhone"
            autoComplete="off"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(514) 555-0199"
          />
        </div>
      </div>

      {/* Saved-address picker — only when the linked client has addresses. */}
      {selected && savedAddresses.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <label className="cnf-sub-label">Address on file</label>
          <PremiumSelect
            value={addressChoice}
            onChange={onAddressChoice}
            size="md"
            options={[
              ...savedAddresses.map((a) => ({
                value: a.id,
                label: `${a.label} — ${a.address}${
                  a.aptNumber ? ` (${a.aptNumber})` : ""
                }${a.isDefault ? " · default" : ""}`,
              })),
              { value: NEW_ADDRESS, label: "+ Type a new address" },
            ]}
          />
          <p style={{ marginTop: 4, fontSize: 11.5, color: "var(--primary-50)" }}>
            Pick a saved address, or choose “Type a new address” and fill the
            Location field below.
          </p>
        </div>
      )}

      {selected &&
        (selected.defaultPaymentMethodId || cardSavedNow ? (
          <div
            style={{
              marginTop: 8,
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
            clientId={selected.id}
            clientName={selected.name}
            clientEmail={selected.email ?? null}
            onSaved={() => setCardSavedNow(true)}
          />
        ))}

      <style>{`
        .client-typeahead { position: absolute; z-index: 50; top: calc(100% + 4px); left: 0; right: 0; background: #fff; border: 1px solid rgba(0,140,156,0.15); border-radius: 14px; box-shadow: 0 18px 48px rgba(0,140,156,0.18); padding: 6px; max-height: 280px; overflow-y: auto; }
        .client-typeahead-row { width: 100%; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 8px 10px; border: 0; background: none; border-radius: 9px; cursor: pointer; text-align: left; }
        .client-typeahead-row:hover { background: rgba(0,140,156,0.06); }
        .client-typeahead-name { font-size: 13.5px; color: #0e1a1c; font-weight: 500; }
        .client-typeahead-sub { font-size: 11.5px; color: rgba(0,140,156,0.6); }
        .client-typeahead-linked { margin-top: 6px; font-size: 12px; color: #166534; }
        .cnf-contact-grid { margin-top: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 640px) { .cnf-contact-grid { grid-template-columns: 1fr; } }
        .cnf-sub-label { display: block; font-size: 11px; font-weight: 600; color: var(--primary-60); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 5px; }
      `}</style>
    </div>
  );
}

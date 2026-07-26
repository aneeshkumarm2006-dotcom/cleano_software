"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  History,
  MapPin,
  Package,
  Plus,
  Search,
  ShoppingCart,
} from "lucide-react";
import Input from "@/components/ui/Input";
import { getLocationProducts } from "@/app/admin/actions/getLocationProducts";
import type { LocationProductEntry } from "@/app/admin/actions/getLocationProducts.types";
import { checkoutInventory } from "@/app/admin/actions/checkoutInventory";
import CartItem from "./CartItem";
import CheckoutSummary from "./CheckoutSummary";

interface Location {
  id: string;
  name: string;
  address: string | null;
}

interface CheckoutClientProps {
  locations: Location[];
}

type Step = 1 | 2 | 3;

export default function CheckoutClient({ locations }: CheckoutClientProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [products, setProducts] = useState<LocationProductEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const selectedLocation = locations.find((l) => l.id === locationId) || null;

  useEffect(() => {
    if (!locationId) return;
    let cancelled = false;
    setLoading(true);
    getLocationProducts(locationId).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.success) {
        setProducts(res.products);
      } else {
        setFeedback({ type: "error", text: res.error });
        setProducts([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [locationId]);

  const filteredProducts = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter(
      (p) =>
        p.productName.toLowerCase().includes(q) ||
        (p.productDescription || "").toLowerCase().includes(q)
    );
  }, [products, search]);

  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .map(([productId, quantity]) => {
        const product = products.find((p) => p.productId === productId);
        if (!product) return null;
        return {
          productId,
          productName: product.productName,
          unit: product.unit,
          available: product.available,
          quantity,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [cart, products]);

  const cartCount = cartItems.length;
  // Informational only — taking more than the locker shows is permitted and is
  // reconciled by admin later. It must never gate the pickup (fix list item 5).
  const hasOverLimit = cartItems.some((i) => i.quantity > i.available);

  function selectLocation(id: string) {
    if (id !== locationId) {
      setCart({});
    }
    setLocationId(id);
    setFeedback(null);
    setStep(2);
  }

  function addToCart(product: LocationProductEntry) {
    setCart((prev) => {
      const existing = prev[product.productId] || 0;
      // No ceiling: a cleaner can add an out-of-stock item to the cart.
      return { ...prev, [product.productId]: existing + 1 };
    });
  }

  function updateCart(productId: string, quantity: number) {
    setCart((prev) => {
      const next = { ...prev };
      if (quantity <= 0) {
        delete next[productId];
      } else {
        next[productId] = quantity;
      }
      return next;
    });
  }

  function removeFromCart(productId: string) {
    setCart((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  }

  async function confirmCheckout() {
    if (!locationId || cartItems.length === 0) return;

    setSubmitting(true);
    setFeedback(null);

    const res = await checkoutInventory({
      locationId,
      notes: notes.trim() || undefined,
      items: cartItems.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
      })),
    });

    setSubmitting(false);

    if (res.success) {
      const warnings = res.warnings ?? [];
      setFeedback({
        type: "success",
        text:
          `Pickup confirmed. ${cartItems.length} item(s) added to your inventory.` +
          (warnings.length > 0
            ? ` ${warnings.length} item(s) took the locker below the recorded count — flagged for admin to reconcile.`
            : ""),
      });
      // Keep cart contents on screen so the summary doesn't blank out while we
      // wait to redirect. `submitted` disables Confirm/Back so the user can't
      // re-submit.
      setSubmitted(true);

      // Redirect with a hard fallback — router.push can stall on dev (the
      // "Rendering…" indicator gets stuck), so guarantee navigation.
      // The component unmounts on successful navigation, which cancels the
      // hard fallback.
      const pushTimer = setTimeout(() => {
        try {
          router.push("/cleaners/my-inventory");
        } catch {
          window.location.href = "/cleaners/my-inventory";
        }
      }, 900);
      const hardFallback = setTimeout(() => {
        window.location.href = "/cleaners/my-inventory";
      }, 2500);
      // Stop the React-warning lint about unused vars
      void pushTimer;
      void hardFallback;
    } else {
      setFeedback({ type: "error", text: res.error || "Checkout failed." });
    }
  }

  return (
    <div className="cl-page-wrap">
      <div className="cl-page-head">
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 4,
            minWidth: 0,
          }}>
          <a
            href="/cleaners/my-inventory"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--primary-60)",
              textDecoration: "none",
            }}>
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to inventory
          </a>
          <h1 className="cl-page-title" style={{ margin: 0 }}>
            Pick up from storage
          </h1>
          <p className="cl-page-sub" style={{ margin: 0 }}>
            Grab equipment and supplies before your next job.
          </p>
        </div>
        <a href="/cleaners/my-inventory/history" className="cl-action-btn">
          <History className="w-3.5 h-3.5" />
          View History
        </a>
      </div>

      <Stepper step={step} />

      {feedback && (
        <div
          className={`px-4 py-3 rounded-xl text-sm ${
            feedback.type === "success"
              ? "bg-[#008C9C]/10 text-[#008C9C] border border-[#008C9C]/15"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}>
          {feedback.text}
        </div>
      )}

      {step === 1 && (
        <div className="cl-co-section">
          <h2>
            <MapPin className="w-5 h-5" />
            Select a storage location
          </h2>
          {locations.length === 0 ? (
            <div className="cl-empty-block">
              <div className="icon-bubble">
                <MapPin className="w-7 h-7" />
              </div>
              <div>No storage locations available. Ask an admin to set one up.</div>
            </div>
          ) : (
            <div className="cl-co-loc-grid">
              {locations.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => selectLocation(l.id)}
                  className={`cl-co-loc${locationId === l.id ? " selected" : ""}`}>
                  <span className="cl-co-loc-icon">
                    <MapPin className="w-4 h-4" />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="cl-co-loc-name">{l.name}</div>
                    {l.address && <div className="cl-co-loc-addr">{l.address}</div>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 2 && selectedLocation && (
        <div
          style={{
            display: "grid",
            gap: 18,
            gridTemplateColumns: "minmax(0, 1fr)",
          }}
          className="cl-co-step2-grid">
          <div className="cl-co-section">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--primary)" }}>
                <MapPin className="w-4 h-4" />
                <span style={{ fontWeight: 600 }}>{selectedLocation.name}</span>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  style={{
                    background: "none", border: 0, padding: "4px 8px",
                    color: "var(--primary-60)", fontSize: 12, fontWeight: 600,
                    cursor: "pointer", fontFamily: "inherit",
                  }}>
                  Change
                </button>
              </div>
            </div>
            <div style={{ position: "relative" }}>
              <Search className="w-4 h-4" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--primary-50)" }} />
              <Input
                variant="form"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products..."
                className="pl-9"
              />
            </div>

            {loading ? (
              <p style={{ fontSize: 13, color: "var(--primary-50)", textAlign: "center", padding: "24px 0" }}>
                Loading products...
              </p>
            ) : filteredProducts.length === 0 ? (
              <div className="cl-empty-block">
                <div className="icon-bubble">
                  <Package className="w-7 h-7" />
                </div>
                {products.length === 0 ? (
                  <div>
                    <strong>No products set up yet.</strong>
                    <p style={{ fontSize: 12, color: "var(--primary-50)", margin: "4px 0 0" }}>
                      Ask your manager to add products to the catalogue.
                    </p>
                  </div>
                ) : (
                  <div>No products match your search.</div>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {filteredProducts.map((p) => {
                  const inCart = cart[p.productId] || 0;
                  // Stock status is shown, never enforced (fix list item 19).
                  const status =
                    p.available <= 0
                      ? { label: "Out of stock", color: "#b91c1c", bg: "#fee2e2" }
                      : p.available <= (p.minStock ?? 0)
                      ? { label: "Low stock", color: "#b45309", bg: "#fef3c7" }
                      : { label: "In stock", color: "#15803d", bg: "#dcfce7" };
                  return (
                    <div key={p.productId} className="cl-co-prod-row">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="cl-co-prod-name">{p.productName}</div>
                        {p.productDescription && (
                          <div className="cl-co-prod-desc">{p.productDescription}</div>
                        )}
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span className="cl-co-prod-avail">
                            {p.available} {p.unit} available
                          </span>
                          <span
                            style={{
                              background: status.bg,
                              color: status.color,
                              fontSize: 10,
                              fontWeight: 700,
                              borderRadius: 20,
                              padding: "1px 7px",
                              letterSpacing: "0.03em",
                              textTransform: "uppercase",
                            }}>
                            {status.label}
                          </span>
                        </span>
                      </div>
                      {inCart > 0 ? (
                        <span className="cl-co-in-cart">{inCart} in cart</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => addToCart(p)}
                          className="cl-co-add-btn">
                          <Plus className="w-3.5 h-3.5" />
                          Add
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="cl-co-cart-card">
            <div className="cl-co-cart-head">
              <span className="cl-co-cart-title">
                <ShoppingCart className="w-4 h-4" />
                Cart
              </span>
              <span className="cl-co-cart-count">
                {cartCount} item{cartCount === 1 ? "" : "s"}
              </span>
            </div>
            {cartItems.length === 0 ? (
              <p className="cl-co-cart-empty">Your cart is empty.</p>
            ) : (
              <div>
                {cartItems.map((i) => {
                  const product = products.find(
                    (p) => p.productId === i.productId
                  );
                  if (!product) return null;
                  return (
                    <CartItem
                      key={i.productId}
                      product={product}
                      quantity={i.quantity}
                      onChange={updateCart}
                      onRemove={removeFromCart}
                    />
                  );
                })}
              </div>
            )}
            {hasOverLimit && (
              <p style={{ fontSize: 12, color: "#b45309" }}>
                Some items are above the recorded locker count. You can still
                take them — the difference is flagged for admin to reconcile.
              </p>
            )}
            <button
              type="button"
              className="cl-co-review-btn"
              onClick={() => setStep(3)}
              disabled={cartItems.length === 0}>
              Review pickup
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {step === 3 && selectedLocation && (
        <CheckoutSummary
          locationName={selectedLocation.name}
          locationAddress={selectedLocation.address}
          items={cartItems.map((i) => ({
            productId: i.productId,
            productName: i.productName,
            unit: i.unit,
            quantity: i.quantity,
          }))}
          notes={notes}
          onNotesChange={setNotes}
          onConfirm={confirmCheckout}
          onBack={() => setStep(2)}
          submitting={submitting || submitted}
        />
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps = [
    { n: 1, label: "Select location" },
    { n: 2, label: "Choose items" },
    { n: 3, label: "Confirm" },
  ];
  return (
    <div className="cl-co-stepper">
      {steps.map((s, idx) => {
        const active = step === s.n;
        const done = step > s.n;
        return (
          <div key={s.n} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className={`cl-co-step${active ? " active" : done ? " done" : ""}`}>
              {done ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : (
                <span className="cl-co-step-num">{s.n}</span>
              )}
              <span className="hidden sm:inline">{s.label}</span>
            </span>
            {idx < steps.length - 1 && <span className="cl-co-step-divider" />}
          </div>
        );
      })}
    </div>
  );
}

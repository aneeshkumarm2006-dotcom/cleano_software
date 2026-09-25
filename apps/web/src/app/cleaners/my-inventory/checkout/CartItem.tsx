"use client";

import { useEffect, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { parseQuantityInput } from "@/lib/quantity-input";
import type { LocationProductEntry } from "@/app/admin/actions/getLocationProducts.types";

interface CartItemProps {
  product: LocationProductEntry;
  quantity: number;
  onChange: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
}

export default function CartItem({
  product,
  quantity,
  onChange,
  onRemove,
}: CartItemProps) {
  // Taking more than the locker shows is allowed — supplies get restocked and
  // handed out outside the app, so the count is an estimate, not a gate. We
  // inform the cleaner and let the admin reconcile later (fix list items 5 + 19).
  const overLimit = quantity > product.available;

  /**
   * A local string draft of the box (Stage 6 · PDF #3).
   *
   * The cart itself only holds numbers, and `updateCart(id, 0)` DELETES the line
   * — so pushing every keystroke straight up meant clearing the field made the
   * row vanish mid-edit (the old `parseFloat(value) || 0`). The draft lets the
   * box sit empty while the cleaner retypes; the cart is only told about a
   * value it can actually hold, and an abandoned edit is reverted on blur.
   */
  const [draft, setDraft] = useState(String(quantity));

  // Follow the cart when it changes underneath us (+/− buttons, "add again").
  useEffect(() => {
    setDraft(String(quantity));
  }, [quantity]);

  function commit(raw: string) {
    const parsed = parseQuantityInput(raw, { min: 1 });
    if (parsed.ok) onChange(product.productId, parsed.value);
  }

  function increment() {
    onChange(product.productId, quantity + 1);
  }

  function decrement() {
    if (quantity > 1) {
      onChange(product.productId, quantity - 1);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-gray-100 last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="font-[400] text-gray-900 truncate">
          {product.productName}
        </div>
        <div className="text-xs text-gray-600 mt-0.5">
          {product.available} {product.unit} available
        </div>
        {overLimit && (
          <div className="text-xs text-amber-700 mt-0.5">
            More than the locker shows — you can still take it, it&apos;ll be
            flagged for admin to reconcile.
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          submit={false}
          onClick={decrement}
          disabled={quantity <= 1}
          className="!px-2">
          <Minus className="w-3 h-3" />
        </Button>
        <Input
          variant="form"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          aria-label={`Quantity of ${product.productName}`}
          value={draft}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setDraft(e.target.value);
            commit(e.target.value);
          }}
          // An empty or nonsense box reverts to what the cart holds rather than
          // silently becoming 0 (which would drop the line).
          onBlur={() => setDraft(String(quantity))}
          className={`!w-20 text-center !text-base ${
            overLimit ? "!border-amber-400 !text-amber-700" : ""
          }`}
        />
        <Button
          variant="ghost"
          size="sm"
          submit={false}
          onClick={increment}
          className="!px-2">
          <Plus className="w-3 h-3" />
        </Button>
        <span className="text-xs text-gray-600 w-10">{product.unit}</span>
        <Button
          variant="ghost"
          size="sm"
          submit={false}
          onClick={() => onRemove(product.productId)}
          className="!px-2 text-red-600 hover:text-red-700">
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

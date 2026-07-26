"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
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
        <div className="text-xs text-gray-500 mt-0.5">
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
          type="number"
          min="0"
          step="0.01"
          value={quantity}
          onChange={(e) =>
            onChange(product.productId, parseFloat(e.target.value) || 0)
          }
          className={`!w-20 text-center ${
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
        <span className="text-xs text-gray-500 w-10">{product.unit}</span>
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

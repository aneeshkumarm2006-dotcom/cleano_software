"use client";

import React from "react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { DollarSign, TrendingDown, Package } from "lucide-react";

interface SupplierPriceEntry {
  supplierId: string;
  supplierName: string;
  price: number;
  unit: string | null;
  notes: string | null;
}

interface ProductWithPrices {
  productId: string;
  productName: string;
  unit: string;
  costPerUnit: number;
  supplierPrices: SupplierPriceEntry[];
}

interface SupplierComparisonProps {
  products: ProductWithPrices[];
  suppliers: Array<{ id: string; name: string; website?: string | null }>;
}

/**
 * Only http(s) URLs are safe to link to. Anything else (e.g. javascript:)
 * is rejected so a stored value can never be used as an XSS vector.
 */
function safeWebsite(raw?: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export default function SupplierComparison({
  products,
  suppliers,
}: SupplierComparisonProps) {
  const productsWithMultiplePrices = products.filter(
    (p) => p.supplierPrices.length > 0
  );

  const websiteById = new Map(
    suppliers.map((s) => [s.id, safeWebsite(s.website)])
  );

  if (productsWithMultiplePrices.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-[#008C9C]/5 rounded-full flex items-center justify-center mx-auto mb-3">
          <DollarSign className="w-8 h-8 text-[#008C9C]/40" />
        </div>
        <p className="text-sm font-[350] text-[#008C9C]/70">
          No supplier pricing data available
        </p>
        <p className="text-xs font-[350] text-[#008C9C]/60 mt-1">
          Add supplier prices in Settings to see comparisons
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-[350] tracking-tight text-[#008C9C]">
            Supplier Comparison
          </h2>
          <p className="text-sm text-[#008C9C]/70 mt-1">
            Compare prices across suppliers to find the best deals
          </p>
        </div>
        <Badge variant="cleano" size="sm">
          {productsWithMultiplePrices.length} products
        </Badge>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block">
        <div className="bg-white rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#008C9C]/5">
                  <th className="p-4 text-left text-xs font-[350] text-[#008C9C]/40 uppercase tracking-wide min-w-[180px]">
                    Product
                  </th>
                  <th className="p-4 text-left text-xs font-[350] text-[#008C9C]/40 uppercase tracking-wide min-w-[100px]">
                    Current Cost
                  </th>
                  {suppliers.map((s) => {
                    const url = websiteById.get(s.id);
                    return (
                      <th
                        key={s.id}
                        className="p-4 text-left text-xs font-[350] text-[#008C9C]/40 uppercase tracking-wide min-w-[120px]">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#008C9C] hover:underline underline-offset-2 normal-case tracking-normal">
                            {s.name}
                          </a>
                        ) : (
                          s.name
                        )}
                        {url && (
                          <span className="block normal-case tracking-normal text-[10px] text-[#008C9C]/40 truncate max-w-[140px]">
                            {url.replace(/^https?:\/\//, "")}
                          </span>
                        )}
                      </th>
                    );
                  })}
                  <th className="p-4 text-left text-xs font-[350] text-[#008C9C]/40 uppercase tracking-wide min-w-[120px]">
                    Best Price
                  </th>
                  <th className="p-4 text-left text-xs font-[350] text-[#008C9C]/40 uppercase tracking-wide min-w-[100px]">
                    Savings
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#008C9C]/4">
                {productsWithMultiplePrices.map((product) => {
                  const prices = product.supplierPrices;
                  const cheapest =
                    prices.length > 0
                      ? prices.reduce((min, p) =>
                          p.price < min.price ? p : min
                        )
                      : null;
                  const savings = cheapest
                    ? Math.max(0, product.costPerUnit - cheapest.price)
                    : 0;
                  const savingsPercent =
                    product.costPerUnit > 0 && savings > 0
                      ? ((savings / product.costPerUnit) * 100).toFixed(1)
                      : null;

                  return (
                    <tr
                      key={product.productId}
                      className="hover:bg-[#008C9C]/1 transition-colors">
                      <td className="p-4">
                        <p className="text-sm font-[350] text-[#008C9C]">
                          {product.productName}
                        </p>
                        <p className="text-xs text-[#008C9C]/50 mt-0.5">
                          per {product.unit}
                        </p>
                      </td>
                      <td className="p-4">
                        <span className="text-sm font-[350] text-[#008C9C]">
                          ${product.costPerUnit.toFixed(2)}
                        </span>
                      </td>
                      {suppliers.map((s) => {
                        const entry = prices.find(
                          (p) => p.supplierId === s.id
                        );
                        const isCheapest =
                          cheapest && entry?.supplierId === cheapest.supplierId;
                        return (
                          <td key={s.id} className="p-4">
                            {entry ? (
                              <div>
                                <span
                                  className={`text-sm font-[350] ${
                                    isCheapest
                                      ? "text-green-600 font-[500]"
                                      : "text-[#008C9C]"
                                  }`}>
                                  ${entry.price.toFixed(2)}
                                  {isCheapest && prices.length > 1 && (
                                    <span className="ml-1 text-xs text-green-500">
                                      *
                                    </span>
                                  )}
                                </span>
                                <span className="block text-[10px] text-[#008C9C]/40">
                                  per {entry.unit || product.unit}
                                </span>
                              </div>
                            ) : (
                              <span className="text-sm text-[#008C9C]/30">
                                -
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="p-4">
                        {cheapest ? (
                          <div>
                            <span className="text-sm font-[400] text-green-600">
                              ${cheapest.price.toFixed(2)}
                            </span>
                            <p className="text-xs text-[#008C9C]/50">
                              {cheapest.supplierName}
                            </p>
                          </div>
                        ) : (
                          <span className="text-sm text-[#008C9C]/30">-</span>
                        )}
                      </td>
                      <td className="p-4">
                        {savings > 0 ? (
                          <Badge variant="success" size="sm">
                            ${savings.toFixed(2)} ({savingsPercent}%)
                          </Badge>
                        ) : (
                          <span className="text-xs text-[#008C9C]/40">
                            No savings
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-3">
        {productsWithMultiplePrices.map((product) => {
          const prices = product.supplierPrices;
          const cheapest =
            prices.length > 0
              ? prices.reduce((min, p) => (p.price < min.price ? p : min))
              : null;
          const savings = cheapest
            ? Math.max(0, product.costPerUnit - cheapest.price)
            : 0;

          return (
            <Card key={product.productId} variant="cleano_light" className="p-4">
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-[400] text-[#008C9C]">
                      {product.productName}
                    </p>
                    <p className="text-xs text-[#008C9C]/60">
                      Current: ${product.costPerUnit.toFixed(2)} / {product.unit}
                    </p>
                  </div>
                  {savings > 0 && (
                    <Badge variant="success" size="sm">
                      Save ${savings.toFixed(2)}
                    </Badge>
                  )}
                </div>
                <div className="space-y-1">
                  {prices.map((p) => {
                    const isCheapest =
                      cheapest && p.supplierId === cheapest.supplierId;
                    const url = websiteById.get(p.supplierId);
                    return (
                      <div
                        key={p.supplierId}
                        className={`flex items-center justify-between p-2 rounded-lg ${
                          isCheapest ? "bg-green-50" : "bg-white"
                        }`}>
                        <span
                          className={`text-xs ${
                            isCheapest
                              ? "text-green-700 font-[400]"
                              : "text-[#008C9C]/70"
                          }`}>
                          {url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline underline-offset-2">
                              {p.supplierName}
                            </a>
                          ) : (
                            p.supplierName
                          )}
                        </span>
                        <span
                          className={`text-xs font-[400] ${
                            isCheapest ? "text-green-600" : "text-[#008C9C]"
                          }`}>
                          ${p.price.toFixed(2)}
                          <span className="text-[#008C9C]/40">
                            {" "}
                            / {p.unit || product.unit}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

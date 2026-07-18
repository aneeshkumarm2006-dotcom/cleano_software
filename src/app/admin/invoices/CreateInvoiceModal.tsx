"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Trash2, Loader } from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import PremiumSelect from "@/components/ui/PremiumSelect";
import DatePicker from "@/components/ui/DatePicker";
import { createInvoice } from "../actions/createInvoice";
import {
  getClientJobsForInvoice,
  type InvoiceJobOption,
} from "../actions/getClientJobsForInvoice";
import { jobTypeLabel } from "@/lib/calendar-labels";
import { fmtDate } from "@/lib/time";

interface ClientOption {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  discountPercent?: number | null;
}

interface CreateInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  clients: ClientOption[];
  taxConfig: {
    gstRate: number;
    qstRate: number;
  };
}

interface LineItemRow {
  description: string;
  quantity: number;
  unitPrice: number;
}

export default function CreateInvoiceModal({
  isOpen,
  onClose,
  clients,
  taxConfig,
}: CreateInvoiceModalProps) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [discountMode, setDiscountMode] = useState<"percent" | "amount">(
    "percent"
  );
  const [discountInput, setDiscountInput] = useState<string>("");
  const [discountTouched, setDiscountTouched] = useState(false);
  const [lineItems, setLineItems] = useState<LineItemRow[]>([
    { description: "", quantity: 1, unitPrice: 0 },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Consolidated invoices: pick any number of the client's unpaid jobs — each
  // becomes a linked line item, so paying this invoice pays those jobs.
  const [clientJobs, setClientJobs] = useState<InvoiceJobOption[]>([]);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);

  useEffect(() => {
    setSelectedJobIds([]);
    setClientJobs([]);
    if (!clientId) return;
    let cancelled = false;
    setJobsLoading(true);
    getClientJobsForInvoice(clientId)
      .then((res) => {
        if (!cancelled && res.success) setClientJobs(res.jobs);
      })
      .finally(() => {
        if (!cancelled) setJobsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const selectedClient = clients.find((c) => c.id === clientId) || null;

  // Auto-prefill discount from client's default unless admin has touched the field
  useEffect(() => {
    if (discountTouched) return;
    if (selectedClient && (selectedClient.discountPercent ?? 0) > 0) {
      setDiscountMode("percent");
      setDiscountInput(String(selectedClient.discountPercent));
    } else {
      setDiscountInput("");
    }
  }, [selectedClient, discountTouched]);

  if (!isOpen) return null;

  const selectedJobsTotal = clientJobs
    .filter((j) => selectedJobIds.includes(j.id))
    .reduce((sum, j) => sum + j.amount, 0);
  const subtotal =
    selectedJobsTotal +
    lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0);
  const discountValue = parseFloat(discountInput);
  const discount =
    Number.isFinite(discountValue) && discountValue > 0
      ? discountMode === "percent"
        ? +(subtotal * (discountValue / 100)).toFixed(2)
        : discountValue
      : 0;
  const taxableAmount = subtotal - discount;
  const gstAmount = (taxableAmount * taxConfig.gstRate) / 100;
  const qstAmount = (taxableAmount * taxConfig.qstRate) / 100;
  const totalAmount = taxableAmount + gstAmount + qstAmount;

  const addLineItem = () => {
    setLineItems([...lineItems, { description: "", quantity: 1, unitPrice: 0 }]);
  };

  const removeLineItem = (idx: number) => {
    if (lineItems.length <= 1) return;
    setLineItems(lineItems.filter((_, i) => i !== idx));
  };

  const updateLineItem = (
    idx: number,
    field: keyof LineItemRow,
    value: string | number
  ) => {
    const updated = [...lineItems];
    if (field === "description") {
      updated[idx].description = value as string;
    } else {
      updated[idx][field] = Number(value) || 0;
    }
    setLineItems(updated);
  };

  const handleSubmit = async () => {
    if (!clientId) {
      setError("Please select a client");
      return;
    }
    // Blank rows are dropped (a jobs-only consolidated invoice needs no manual
    // lines); a row with any amount still needs a description.
    const filledLineItems = lineItems.filter(
      (li) => li.description.trim() || li.quantity * li.unitPrice > 0
    );
    if (filledLineItems.some((li) => !li.description.trim())) {
      setError("All line items need a description");
      return;
    }
    if (filledLineItems.length === 0 && selectedJobIds.length === 0) {
      setError("Select at least one job or add a line item");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const result = await createInvoice({
      clientId,
      jobIds: selectedJobIds,
      lineItems: filledLineItems.map((li) => ({
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
      })),
      discountAmount: discount,
      notes: notes || null,
      dueDate: dueDate || null,
    });

    setIsSubmitting(false);

    if (result.success) {
      onClose();
      router.refresh();
      if (result.invoiceId) {
        router.push(`/admin/invoices/${result.invoiceId}`);
      }
    } else {
      setError(result.error || "Failed to create invoice");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl mx-4">
        <div className="flex items-center justify-between p-6 border-b border-[#008C9C]/10">
          <h2 className="text-xl font-[350] text-[#008C9C]">New Invoice</h2>
          <button onClick={onClose} className="p-2 hover:bg-[#008C9C]/5 rounded-xl">
            <X className="w-5 h-5 text-[#008C9C]/60" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Client */}
          <div>
            <label className="input-label !text-[#008C9C]/70 block mb-1.5">Client</label>
            <PremiumSelect
              value={clientId}
              onChange={(v) => {
                setClientId(v);
                setDiscountTouched(false);
              }}
              options={[
                { value: "", label: "Select a client..." },
                ...clients.map((c) => ({ value: c.id, label: c.name })),
              ]}
              placeholder="Select a client..."
              searchable
              size="md"
            />
          </div>

          {/* Due Date */}
          <div>
            <label className="input-label !text-[#008C9C]/70 block mb-1.5">Due Date</label>
            <DatePicker
              value={dueDate}
              onChange={setDueDate}
              size="md"
            />
          </div>

          {/* Jobs to consolidate (optional) */}
          {clientId && (
            <div>
              <label className="input-label !text-[#008C9C]/70 block mb-1.5">
                Include jobs{selectedJobIds.length > 0 ? ` (${selectedJobIds.length} selected)` : ""}
              </label>
              {jobsLoading ? (
                <p className="text-xs text-[#008C9C]/50">Loading jobs…</p>
              ) : clientJobs.length === 0 ? (
                <p className="text-xs text-[#008C9C]/50">
                  No unpaid jobs for this client — use line items below.
                </p>
              ) : (
                <div className="max-h-44 overflow-y-auto rounded-2xl border border-[#008C9C]/10 divide-y divide-[#008C9C]/5">
                  {clientJobs.map((j) => (
                    <label
                      key={j.id}
                      className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-[#008C9C]/5">
                      <input
                        type="checkbox"
                        checked={selectedJobIds.includes(j.id)}
                        onChange={(e) =>
                          setSelectedJobIds((ids) =>
                            e.target.checked
                              ? [...ids, j.id]
                              : ids.filter((id) => id !== j.id)
                          )
                        }
                      />
                      <span className="flex-1 text-[#008C9C]">
                        Job #{j.jobNumber}
                        {j.jobType ? ` · ${jobTypeLabel(j.jobType)}` : ""} ·{" "}
                        {fmtDate(j.startTime, { month: "short", day: "numeric", year: "numeric" })}
                        {j.invoiceSent && (
                          <span className="ml-2 text-[11px] text-amber-600">already invoiced</span>
                        )}
                      </span>
                      <span className="text-[#008C9C]/70">${j.amount.toFixed(2)}</span>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-[#008C9C]/50 mt-1">
                Selected jobs become line items; marking this invoice paid marks every included job paid.
              </p>
            </div>
          )}

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="input-label !text-[#008C9C]/70">Line Items</label>
              <button
                onClick={addLineItem}
                className="text-xs text-[#008C9C] hover:text-[#008C9C]/80 flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Add Item
              </button>
            </div>
            <div className="space-y-2">
              {lineItems.map((li, idx) => (
                <div key={idx} className="flex gap-2 items-start">
                  <div className="flex-1">
                    <Input
                      placeholder="Description"
                      value={li.description}
                      onChange={(e) => updateLineItem(idx, "description", e.target.value)}
                      variant="form"
                      border={false}
                      className="h-[38px]"
                    />
                  </div>
                  <div className="w-20">
                    <Input
                      type="number"
                      placeholder="Qty"
                      value={li.quantity || ""}
                      onChange={(e) => updateLineItem(idx, "quantity", e.target.value)}
                      variant="form"
                      border={false}
                      className="h-[38px] text-center"
                      min={0}
                      step="0.01"
                    />
                  </div>
                  <div className="w-28">
                    <Input
                      type="number"
                      placeholder="Price"
                      value={li.unitPrice || ""}
                      onChange={(e) => updateLineItem(idx, "unitPrice", e.target.value)}
                      variant="form"
                      border={false}
                      className="h-[38px] text-right"
                      min={0}
                      step="0.01"
                    />
                  </div>
                  <div className="w-24 text-right text-sm text-[#008C9C]/70 pt-2">
                    ${(li.quantity * li.unitPrice).toFixed(2)}
                  </div>
                  {lineItems.length > 1 && (
                    <button
                      onClick={() => removeLineItem(idx)}
                      className="p-2 hover:bg-red-50 rounded-xl text-red-400 hover:text-red-600">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Discount */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="input-label !text-[#008C9C]/70">
                Discount
              </label>
              <div className="flex bg-[#008C9C]/5 rounded-xl p-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setDiscountMode("percent");
                    setDiscountTouched(true);
                  }}
                  className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                    discountMode === "percent"
                      ? "bg-[#008C9C] text-white"
                      : "text-[#008C9C]/60"
                  }`}>
                  %
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDiscountMode("amount");
                    setDiscountTouched(true);
                  }}
                  className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                    discountMode === "amount"
                      ? "bg-[#008C9C] text-white"
                      : "text-[#008C9C]/60"
                  }`}>
                  $
                </button>
              </div>
            </div>
            <Input
              type="number"
              value={discountInput}
              onChange={(e) => {
                setDiscountInput(e.target.value);
                setDiscountTouched(true);
              }}
              variant="form"
              border={false}
              className="h-[42px]"
              min={0}
              step="0.01"
              placeholder={discountMode === "percent" ? "0" : "0.00"}
            />
            {selectedClient &&
              (selectedClient.discountPercent ?? 0) > 0 &&
              !discountTouched && (
                <p className="text-[11px] text-[#008C9C]/60 mt-1">
                  Auto-applied from client default ({selectedClient.discountPercent}%)
                </p>
              )}
          </div>

          {/* Notes */}
          <div>
            <label className="input-label !text-[#008C9C]/70 block mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              rows={2}
              className="w-full px-3 py-2 text-sm bg-[#008C9C]/5 text-[#008C9C] rounded-2xl border-0 outline-none resize-none placeholder:text-[#008C9C]/40"
            />
          </div>

          {/* Totals */}
          <div className="bg-[#008C9C]/5 rounded-2xl p-4 space-y-2">
            <div className="flex justify-between text-sm text-[#008C9C]/70">
              <span>Subtotal</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-sm text-yellow-700">
                <span>Discount</span>
                <span>-${discount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm text-[#008C9C]/70">
              <span>GST ({taxConfig.gstRate}%)</span>
              <span>${gstAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm text-[#008C9C]/70">
              <span>QST ({taxConfig.qstRate}%)</span>
              <span>${qstAmount.toFixed(2)}</span>
            </div>
            <div className="border-t border-[#008C9C]/10 pt-2 flex justify-between text-base font-[400] text-[#008C9C]">
              <span>Total</span>
              <span>${totalAmount.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-3 p-6 border-t border-[#008C9C]/10">
          <Button
            variant="default"
            size="md"
            border={false}
            onClick={onClose}
            className="rounded-2xl px-6 py-3 flex-1">
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            border={false}
            disabled={isSubmitting}
            onClick={handleSubmit}
            className="rounded-2xl px-6 py-3 flex-1">
            {isSubmitting ? (
              <>
                <Loader className="w-4 h-4 animate-spin mr-2" />
                Creating...
              </>
            ) : (
              "Create Invoice"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

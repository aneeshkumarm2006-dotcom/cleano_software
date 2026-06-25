"use client";

interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  sortOrder: number;
}

interface InvoiceData {
  id: string;
  invoiceNumber: string;
  status: string;
  client: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
  subtotal: number;
  gstAmount: number;
  qstAmount: number;
  discountAmount: number;
  totalAmount: number;
  notes: string | null;
  dueDate: string | null;
  sentAt: string | null;
  paidAt: string | null;
  createdAt: string;
  lineItems: LineItem[];
}

interface InvoicePreviewProps {
  invoice: InvoiceData;
  taxConfig: {
    gstRate: number;
    qstRate: number;
    gstNumber: string;
    qstNumber: string;
  };
}

export default function InvoicePreview({ invoice, taxConfig }: InvoicePreviewProps) {
  return (
    <div className="bg-white rounded-2xl border border-[#008C9C]/10 overflow-hidden print:border-0 print:rounded-none">
      {/* Header */}
      <div className="bg-[#008C9C] text-white p-8 print:p-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-[300] tracking-tight">INVOICE</h1>
            <p className="text-white/70 text-sm mt-1">{invoice.invoiceNumber}</p>
          </div>
          <div className="text-right">
            <h2 className="text-xl font-[300] tracking-tight">Cleano</h2>
            <p className="text-white/70 text-xs mt-1">Professional Cleaning Services</p>
            {taxConfig.gstNumber && (
              <p className="text-white/60 text-xs mt-1">GST: {taxConfig.gstNumber}</p>
            )}
            {taxConfig.qstNumber && (
              <p className="text-white/60 text-xs">QST: {taxConfig.qstNumber}</p>
            )}
          </div>
        </div>
      </div>

      <div className="p-8 print:p-6">
        {/* Billing & Date Info */}
        <div className="flex justify-between mb-8">
          <div>
            <h3 className="text-xs uppercase tracking-wider text-[#008C9C]/40 mb-2">
              Bill To
            </h3>
            <p className="text-sm font-[400] text-[#008C9C]">{invoice.client.name}</p>
            {invoice.client.address && (
              <p className="text-sm text-[#008C9C]/70 mt-0.5">{invoice.client.address}</p>
            )}
            {invoice.client.email && (
              <p className="text-sm text-[#008C9C]/70 mt-0.5">{invoice.client.email}</p>
            )}
            {invoice.client.phone && (
              <p className="text-sm text-[#008C9C]/70 mt-0.5">{invoice.client.phone}</p>
            )}
          </div>
          <div className="text-right">
            <div className="space-y-1.5">
              <div>
                <span className="text-xs uppercase tracking-wider text-[#008C9C]/40">
                  Date Issued
                </span>
                <p className="text-sm text-[#008C9C]">
                  {new Date(invoice.createdAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              </div>
              {invoice.dueDate && (
                <div>
                  <span className="text-xs uppercase tracking-wider text-[#008C9C]/40">
                    Due Date
                  </span>
                  <p className="text-sm text-[#008C9C]">
                    {new Date(invoice.dueDate).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                </div>
              )}
              {invoice.status === "PAID" && invoice.paidAt && (
                <div>
                  <span className="text-xs uppercase tracking-wider text-green-600/70">
                    Paid On
                  </span>
                  <p className="text-sm font-[400] text-green-600">
                    {new Date(invoice.paidAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Line Items Table */}
        <div className="mb-8">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-[#008C9C]/10">
                <th className="text-left py-3 text-xs uppercase tracking-wider text-[#008C9C]/40 font-[350]">
                  Description
                </th>
                <th className="text-center py-3 text-xs uppercase tracking-wider text-[#008C9C]/40 font-[350] w-20">
                  Qty
                </th>
                <th className="text-right py-3 text-xs uppercase tracking-wider text-[#008C9C]/40 font-[350] w-28">
                  Unit Price
                </th>
                <th className="text-right py-3 text-xs uppercase tracking-wider text-[#008C9C]/40 font-[350] w-28">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((item) => (
                <tr key={item.id} className="border-b border-[#008C9C]/5">
                  <td className="py-3 text-sm text-[#008C9C]">{item.description}</td>
                  <td className="py-3 text-sm text-[#008C9C]/70 text-center">{item.quantity}</td>
                  <td className="py-3 text-sm text-[#008C9C]/70 text-right">
                    ${item.unitPrice.toFixed(2)}
                  </td>
                  <td className="py-3 text-sm text-[#008C9C] text-right font-[400]">
                    ${item.amount.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-72 space-y-2">
            <div className="flex justify-between text-sm text-[#008C9C]/70">
              <span>Subtotal</span>
              <span>${invoice.subtotal.toFixed(2)}</span>
            </div>
            {invoice.discountAmount > 0 && (
              <div className="flex justify-between text-sm text-yellow-700">
                <span>Discount</span>
                <span>-${invoice.discountAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm text-[#008C9C]/70">
              <span>GST ({taxConfig.gstRate}%)</span>
              <span>${invoice.gstAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm text-[#008C9C]/70">
              <span>QST ({taxConfig.qstRate}%)</span>
              <span>${invoice.qstAmount.toFixed(2)}</span>
            </div>
            <div className="border-t-2 border-[#008C9C]/10 pt-3 flex justify-between">
              <span className="text-base font-[400] text-[#008C9C]">Total</span>
              <span className="text-xl font-[400] text-[#008C9C]">
                ${invoice.totalAmount.toFixed(2)}
              </span>
            </div>
            {invoice.status === "PAID" && (
              <div className="mt-2 text-center py-2 bg-green-50 rounded-xl">
                <span className="text-sm font-[400] text-green-600 uppercase tracking-wider">
                  Paid
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Notes */}
        {invoice.notes && (
          <div className="mt-8 pt-6 border-t border-[#008C9C]/10">
            <h3 className="text-xs uppercase tracking-wider text-[#008C9C]/40 mb-2">Notes</h3>
            <p className="text-sm text-[#008C9C]/70 whitespace-pre-wrap">{invoice.notes}</p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-[#008C9C]/10 text-center">
          <p className="text-xs text-[#008C9C]/40">
            Thank you for your business. Payment is due{" "}
            {invoice.dueDate
              ? `by ${new Date(invoice.dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
              : "upon receipt"}
            .
          </p>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Send,
  DollarSign,
  Printer,
  CheckCircle2,
  XCircle,
  Loader,
  FileText,
  Briefcase,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import InvoicePreview from "../InvoicePreview";
import { ConfirmActionModal } from "@/components/common/ConfirmActionModal";
import { sendInvoice } from "../../actions/sendInvoice";
import { updateInvoice } from "../../actions/updateInvoice";
import { invoiceDisplayStatus } from "@/lib/invoice-status";

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
  clientId: string;
  client: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
  jobId: string | null;
  job: {
    id: string;
    clientName: string;
    jobType: string | null;
    jobDate: string | null;
    location: string | null;
    description: string | null;
    price: number | null;
    status: string;
  } | null;
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

interface InvoiceDetailViewProps {
  invoice: InvoiceData;
  taxConfig: {
    gstRate: number;
    qstRate: number;
    gstNumber: string;
    qstNumber: string;
  };
}

export default function InvoiceDetailView({
  invoice,
  taxConfig,
}: InvoiceDetailViewProps) {
  const router = useRouter();
  const printRef = useRef<HTMLDivElement>(null);
  const [isSending, setIsSending] = useState(false);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSend = async () => {
    setIsSending(true);
    setErrorMsg(null);
    const result = await sendInvoice(invoice.id);
    setIsSending(false);
    if (!result.success) {
      setErrorMsg(result.error || "Failed to send invoice");
    } else {
      router.refresh();
    }
  };

  const handleMarkPaid = async () => {
    setIsMarkingPaid(true);
    setErrorMsg(null);
    const result = await updateInvoice({ id: invoice.id, status: "PAID" });
    setIsMarkingPaid(false);
    if (!result.success) {
      setErrorMsg(result.error || "Failed to mark as paid");
    } else {
      router.refresh();
    }
  };

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const handleCancel = () => setShowCancelConfirm(true);

  const confirmCancelInvoice = async () => {
    setShowCancelConfirm(false);
    setIsCancelling(true);
    setErrorMsg(null);
    const result = await updateInvoice({ id: invoice.id, status: "CANCELLED" });
    setIsCancelling(false);
    if (!result.success) {
      setErrorMsg(result.error || "Failed to cancel invoice");
    } else {
      router.refresh();
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const getStatusBadge = (status: string) => {
    const config: Record<string, { variant: "default" | "warning" | "success" | "error" | "cleano" | "secondary"; label: string }> = {
      DRAFT: { variant: "default", label: "Draft" },
      SENT: { variant: "secondary", label: "Sent" },
      PAID: { variant: "success", label: "Paid" },
      OVERDUE: { variant: "warning", label: "Overdue" },
      CANCELLED: { variant: "error", label: "Cancelled" },
    };
    const c = config[status] || { variant: "default" as const, label: status };
    return <Badge variant={c.variant} size="md">{c.label}</Badge>;
  };

  return (
    <div className="max-w-[80rem] mx-auto space-y-6 print:max-w-none print:space-y-0 print:p-0">
      {/* Back Button */}
      <Link href="/admin/invoices" className="print:hidden">
        <Button variant="default" size="sm" border={false} className="mb-2 px-6 py-3">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Invoices
        </Button>
      </Link>

      {/* Header */}
      <div className="flex flex-col md:flex-row items-start justify-between gap-4 print:hidden">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl !font-light tracking-tight text-[#008C9C]">
              {invoice.invoiceNumber}
            </h1>
            {/* Derived, so this badge says the same thing the list's pill does
                (@/lib/invoice-status). The ACTION guards below deliberately
                keep reading the stored status — what you may do to an invoice
                is a function of what it is, not of how late it is. */}
            {getStatusBadge(invoiceDisplayStatus(invoice))}
          </div>
          <p className="text-sm text-[#008C9C]/60 mt-1">
            Created {new Date(invoice.createdAt).toLocaleDateString("en-US", {
              weekday: "short",
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </p>
        </div>

        <div className="flex gap-2 flex-wrap print:hidden">
          <Button
            variant="default"
            size="md"
            border={false}
            onClick={handlePrint}
            className="rounded-2xl px-6 py-3">
            <Printer className="w-4 h-4 mr-2" />
            Print
          </Button>
          <a
            href={`/api/invoices/${invoice.id}/pdf`}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-2 rounded-2xl px-6 py-3 text-sm font-medium bg-[#008C9C]/5 text-[#008C9C] hover:bg-[#008C9C]/10">
            <FileText className="w-4 h-4" />
            Download PDF
          </a>
          {invoice.status !== "PAID" && invoice.status !== "CANCELLED" && (
            <Button
              variant="primary"
              size="md"
              border={false}
              disabled={isSending}
              onClick={handleSend}
              className="rounded-2xl px-6 py-3">
              {isSending ? <Loader className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
              {invoice.status === "DRAFT" ? "Send Invoice" : "Resend Invoice"}
            </Button>
          )}
          {(invoice.status === "SENT" || invoice.status === "OVERDUE") && (
            <Button
              variant="primary"
              size="md"
              border={false}
              disabled={isMarkingPaid}
              onClick={handleMarkPaid}
              className="rounded-2xl px-6 py-3">
              {isMarkingPaid ? <Loader className="w-4 h-4 animate-spin mr-2" /> : <DollarSign className="w-4 h-4 mr-2" />}
              Mark Paid
            </Button>
          )}
          {invoice.status !== "PAID" && invoice.status !== "CANCELLED" && (
            <Button
              variant="destructive"
              size="md"
              border={false}
              disabled={isCancelling}
              onClick={handleCancel}
              className="rounded-2xl px-6 py-3">
              {isCancelling ? <Loader className="w-4 h-4 animate-spin mr-2" /> : <XCircle className="w-4 h-4 mr-2" />}
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Error */}
      {errorMsg && (
        <div className="rounded-2xl bg-red-50 border border-red-200 p-3 flex items-start gap-3 print:hidden">
          <div className="flex-1 text-sm text-red-700">{errorMsg}</div>
          <button className="text-xs text-red-600 underline" onClick={() => setErrorMsg(null)}>
            dismiss
          </button>
        </div>
      )}

      {/* Info Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 print:hidden">
        {/* Client Info */}
        <Card variant="cleano_light" className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-[#008C9C]/10 rounded-lg">
              <FileText className="w-4 h-4 text-[#008C9C]" />
            </div>
            <h3 className="text-sm font-[350] text-[#008C9C]/80">Client</h3>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#008C9C]/2">
              <span className="text-sm text-[#008C9C]/70">Name</span>
              <Link href={`/admin/clients/${invoice.client.id}`} className="text-sm font-[400] text-[#008C9C] hover:underline">
                {invoice.client.name}
              </Link>
            </div>
            {invoice.client.email && (
              <div className="flex justify-between items-center p-3 rounded-xl bg-[#008C9C]/2">
                <span className="text-sm text-[#008C9C]/70">Email</span>
                <span className="text-sm text-[#008C9C]">{invoice.client.email}</span>
              </div>
            )}
            {invoice.client.phone && (
              <div className="flex justify-between items-center p-3 rounded-xl bg-[#008C9C]/2">
                <span className="text-sm text-[#008C9C]/70">Phone</span>
                <span className="text-sm text-[#008C9C]">{invoice.client.phone}</span>
              </div>
            )}
            {invoice.client.address && (
              <div className="flex justify-between items-center p-3 rounded-xl bg-[#008C9C]/2">
                <span className="text-sm text-[#008C9C]/70">Address</span>
                <span className="text-sm text-[#008C9C] text-right max-w-[200px]">{invoice.client.address}</span>
              </div>
            )}
          </div>
        </Card>

        {/* Invoice Details */}
        <Card variant="cleano_light" className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-[#008C9C]/10 rounded-lg">
              <DollarSign className="w-4 h-4 text-[#008C9C]" />
            </div>
            <h3 className="text-sm font-[350] text-[#008C9C]/80">Details</h3>
          </div>
          <div className="space-y-2">
            {invoice.dueDate && (
              <div className="flex justify-between items-center p-3 rounded-xl bg-[#008C9C]/2">
                <span className="text-sm text-[#008C9C]/70">Due Date</span>
                <span className="text-sm text-[#008C9C]">
                  {new Date(invoice.dueDate).toLocaleDateString("en-US")}
                </span>
              </div>
            )}
            {invoice.sentAt && (
              <div className="flex justify-between items-center p-3 rounded-xl bg-[#008C9C]/2">
                <span className="text-sm text-[#008C9C]/70">Sent</span>
                <span className="text-sm text-[#008C9C]">
                  {new Date(invoice.sentAt).toLocaleDateString("en-US")}
                </span>
              </div>
            )}
            {invoice.paidAt && (
              <div className="flex justify-between items-center p-3 rounded-xl bg-green-50">
                <span className="text-sm text-green-700">Paid</span>
                <span className="text-sm font-[400] text-green-700">
                  {new Date(invoice.paidAt).toLocaleDateString("en-US")}
                </span>
              </div>
            )}
            {invoice.job && (
              <div className="flex justify-between items-center p-3 rounded-xl bg-[#008C9C]/2">
                <span className="text-sm text-[#008C9C]/70">Linked Job</span>
                <Link href={`/admin/jobs/${invoice.job.id}`} className="text-sm text-[#008C9C] hover:underline flex items-center gap-1">
                  <Briefcase className="w-3.5 h-3.5" />
                  {invoice.job.jobType || "Job"}{invoice.job.jobDate ? ` · ${new Date(invoice.job.jobDate).toLocaleDateString("en-US")}` : ""}
                </Link>
              </div>
            )}
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#008C9C]/10">
              <span className="text-sm font-[400] text-[#008C9C]">Total</span>
              <span className="text-lg font-[400] text-[#008C9C]">
                ${invoice.totalAmount.toFixed(2)}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Notes */}
      {invoice.notes && (
        <Card variant="cleano_light" className="p-6 print:hidden">
          <h3 className="text-sm font-[350] text-[#008C9C]/80 mb-2">Notes</h3>
          <p className="text-sm text-[#008C9C]/70 whitespace-pre-wrap">{invoice.notes}</p>
        </Card>
      )}

      {/* Printable Invoice Preview */}
      <div ref={printRef}>
        <InvoicePreview invoice={invoice} taxConfig={taxConfig} />
      </div>

      <ConfirmActionModal
        isOpen={showCancelConfirm}
        onClose={() => setShowCancelConfirm(false)}
        onConfirm={confirmCancelInvoice}
        title="Cancel invoice?"
        message="This sets the invoice status to Cancelled. This action cannot be undone."
        confirmLabel="Cancel invoice"
        cancelLabel="Keep invoice"
      />
    </div>
  );
}

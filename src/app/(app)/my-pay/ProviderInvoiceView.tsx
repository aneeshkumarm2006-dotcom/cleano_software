"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { Download, FileText, CheckCircle2, AlertCircle } from "lucide-react";
import { generateProviderInvoice } from "../actions/generateProviderInvoice";
import { approveProviderInvoice } from "../actions/approveProviderInvoice";
import type { ProviderInvoice } from "../actions/generateProviderInvoice.types";

function formatDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ProviderInvoiceView() {
  const [loading, setLoading] = useState(false);
  const [invoice, setInvoice] = useState<ProviderInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function handleGenerate() {
    setError(null);
    setLoading(true);
    setApproved(false);
    const result = await generateProviderInvoice({});
    setLoading(false);
    if (result.success) {
      setInvoice(result.invoice);
    } else {
      setError(result.error);
    }
  }

  async function handleApprove() {
    if (!invoice) return;
    setApproving(true);
    setError(null);
    const result = await approveProviderInvoice({
      invoiceNumber: invoice.invoiceNumber,
      subtotal: invoice.subtotal,
      payoutIds: invoice.lines.map((l) => l.payoutId),
    });
    setApproving(false);
    if (result.success) {
      setApproved(true);
    } else {
      setError(result.error ?? "Failed to approve invoice");
    }
  }

  async function handleDownload() {
    if (!invoice) return;
    setDownloading(true);
    setError(null);
    try {
      const { pdf, Document, Page, Text, View, StyleSheet } = await import(
        "@react-pdf/renderer"
      );

      const styles = StyleSheet.create({
        page: { padding: 40, fontSize: 10, fontFamily: "Helvetica" },
        header: {
          flexDirection: "row",
          justifyContent: "space-between",
          marginBottom: 20,
          paddingBottom: 10,
          borderBottomWidth: 1,
          borderBottomColor: "#008C9C",
        },
        title: { fontSize: 18, color: "#008C9C" },
        meta: { fontSize: 9, color: "#666" },
        section: { marginBottom: 14 },
        sectionTitle: {
          fontSize: 9,
          textTransform: "uppercase",
          color: "#888",
          marginBottom: 6,
          letterSpacing: 1,
        },
        row: { flexDirection: "row", paddingVertical: 4 },
        col1: { flex: 3 },
        col2: { flex: 1, textAlign: "right" },
        col3: { flex: 1, textAlign: "right" },
        col4: { flex: 1, textAlign: "right" },
        tableHeader: {
          flexDirection: "row",
          paddingVertical: 6,
          borderBottomWidth: 1,
          borderBottomColor: "#ccc",
          fontSize: 9,
          color: "#666",
          textTransform: "uppercase",
        },
        tableRow: {
          flexDirection: "row",
          paddingVertical: 6,
          borderBottomWidth: 0.5,
          borderBottomColor: "#eee",
        },
        total: {
          flexDirection: "row",
          paddingVertical: 8,
          borderTopWidth: 1,
          borderTopColor: "#008C9C",
          marginTop: 8,
          fontSize: 12,
        },
      });

      const doc = (
        <Document>
          <Page size="A4" style={styles.page}>
            <View style={styles.header}>
              <View>
                <Text style={styles.title}>PROVIDER INVOICE</Text>
                <Text style={styles.meta}>{invoice.invoiceNumber}</Text>
                <Text style={styles.meta}>
                  Generated {formatDate(invoice.generatedAt)}
                </Text>
              </View>
              <View>
                <Text style={{ fontSize: 14, color: "#008C9C" }}>Cleano</Text>
                <Text style={styles.meta}>Service Provider Statement</Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Provider</Text>
              <Text>{invoice.employee.name}</Text>
              <Text style={styles.meta}>{invoice.employee.email}</Text>
              {invoice.employee.phone ? (
                <Text style={styles.meta}>{invoice.employee.phone}</Text>
              ) : null}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Period</Text>
              <Text>
                {formatDate(invoice.periodFrom)} – {formatDate(invoice.periodTo)}
              </Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Line Items</Text>
              <View style={styles.tableHeader}>
                <Text style={styles.col1}>Pay Period</Text>
                <Text style={styles.col2}>Jobs</Text>
                <Text style={styles.col3}>Hours</Text>
                <Text style={styles.col4}>Amount</Text>
              </View>
              {invoice.lines.map((l) => (
                <View key={l.payoutId} style={styles.tableRow}>
                  <Text style={styles.col1}>
                    {formatDate(l.periodStart)} – {formatDate(l.periodEnd)}
                  </Text>
                  <Text style={styles.col2}>{l.jobCount}</Text>
                  <Text style={styles.col3}>{l.totalHours.toFixed(1)}</Text>
                  <Text style={styles.col4}>${l.finalAmount.toFixed(2)}</Text>
                </View>
              ))}
            </View>

            <View style={styles.total}>
              <Text style={styles.col1}>Total</Text>
              <Text style={styles.col2}>{invoice.totalJobs}</Text>
              <Text style={styles.col3}>{invoice.totalHours.toFixed(1)}</Text>
              <Text style={styles.col4}>${invoice.subtotal.toFixed(2)}</Text>
            </View>
          </Page>
        </Document>
      );

      const blob = await pdf(doc).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${invoice.invoiceNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      setError("Failed to generate PDF");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card variant="cleano_light" className="p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#008C9C]" />
            <h2 className="text-lg font-[400] text-[#008C9C]">
              Provider Invoice
            </h2>
          </div>
          <p className="text-sm text-[#008C9C]/70 mt-1">
            Generate an invoice from your payouts to send to accounting.
          </p>
        </div>
        {!invoice && (
          <Button
            variant="primary"
            submit={false}
            onClick={handleGenerate}
            loading={loading}>
            Generate Invoice
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 text-red-700 px-3 py-2 text-sm flex items-start gap-2 mb-4">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {invoice && (
        <div>
          <div className="rounded-2xl bg-white border border-[#008C9C]/10 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-[#008C9C]/50">
                  Invoice
                </p>
                <p className="text-base font-[500] text-[#008C9C]">
                  {invoice.invoiceNumber}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wider text-[#008C9C]/50">
                  Period
                </p>
                <p className="text-sm text-[#008C9C]">
                  {formatDate(invoice.periodFrom)} –{" "}
                  {formatDate(invoice.periodTo)}
                </p>
              </div>
            </div>

            {invoice.lines.length === 0 ? (
              <p className="text-sm text-[#008C9C]/60 py-6 text-center">
                No payouts found for this period.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-[#008C9C]/50">
                      <th className="text-left py-2 pr-3">Pay Period</th>
                      <th className="text-right py-2 px-3">Jobs</th>
                      <th className="text-right py-2 px-3">Hours</th>
                      <th className="text-right py-2 pl-3">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#008C9C]/10">
                    {invoice.lines.map((l) => (
                      <tr key={l.payoutId}>
                        <td className="py-2 pr-3 text-[#008C9C]">
                          {formatDate(l.periodStart)} –{" "}
                          {formatDate(l.periodEnd)}
                        </td>
                        <td className="py-2 px-3 text-right text-[#008C9C]/80">
                          {l.jobCount}
                        </td>
                        <td className="py-2 px-3 text-right text-[#008C9C]/80">
                          {l.totalHours.toFixed(1)}
                        </td>
                        <td className="py-2 pl-3 text-right text-[#008C9C] font-[500]">
                          ${l.finalAmount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-[#008C9C]/30">
                      <td className="py-3 pr-3 text-[#008C9C] font-[500]">
                        Total
                      </td>
                      <td className="py-3 px-3 text-right text-[#008C9C]/80">
                        {invoice.totalJobs}
                      </td>
                      <td className="py-3 px-3 text-right text-[#008C9C]/80">
                        {invoice.totalHours.toFixed(1)}
                      </td>
                      <td className="py-3 pl-3 text-right text-[#008C9C] text-base font-[500]">
                        ${invoice.subtotal.toFixed(2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 mt-4 flex-wrap">
            {approved ? (
              <span className="inline-flex items-center gap-2 text-sm text-green-700 bg-green-50 px-3 py-2 rounded-2xl border border-green-200">
                <CheckCircle2 className="w-4 h-4" />
                Approved & sent to admin
              </span>
            ) : (
              <Button
                variant="action"
                submit={false}
                onClick={handleApprove}
                loading={approving}
                disabled={approving || invoice.lines.length === 0}>
                Approve & Send
              </Button>
            )}
            <Button
              variant="cleano"
              submit={false}
              onClick={handleDownload}
              loading={downloading}
              disabled={downloading || invoice.lines.length === 0}>
              <Download className="w-4 h-4 mr-1" />
              Download PDF
            </Button>
            <Button
              variant="ghost"
              submit={false}
              onClick={() => {
                setInvoice(null);
                setApproved(false);
              }}>
              Reset
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

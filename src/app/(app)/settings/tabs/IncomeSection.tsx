"use client";

import { useEffect, useState } from "react";
import { DollarSign, Download, FileText } from "lucide-react";
import { getIncomeData } from "../../actions/getIncomeData";
import type { IncomeData } from "../../actions/getIncomeData.types";
import { generateTaxSummary } from "../../actions/generateTaxSummary";
import { SectionCard } from "./_shared";

function formatCurrency(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 2,
  });
}

function formatDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface IncomeSectionProps {
  employeeId?: string;
}

export default function IncomeSection({ employeeId }: IncomeSectionProps) {
  const [data, setData] = useState<IncomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await getIncomeData({ employeeId });
      if (cancelled) return;
      if (res.success) {
        setData(res.data);
        setError(null);
      } else {
        setError(res.error);
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      const res = await generateTaxSummary({ employeeId });
      if (!res.success) {
        setError(res.error);
        return;
      }

      const summary = res.summary;
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
        kpis: { flexDirection: "row", gap: 12, marginBottom: 14 },
        kpiBox: {
          flex: 1,
          padding: 10,
          backgroundColor: "#f3f7f8",
          borderRadius: 6,
        },
        kpiLabel: { fontSize: 8, color: "#666", marginBottom: 3 },
        kpiValue: { fontSize: 14, color: "#008C9C" },
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
        col1: { flex: 3 },
        col2: { flex: 1, textAlign: "right" },
        col3: { flex: 1, textAlign: "right" },
        col4: { flex: 1, textAlign: "right" },
        total: {
          flexDirection: "row",
          paddingVertical: 8,
          borderTopWidth: 1,
          borderTopColor: "#008C9C",
          marginTop: 8,
          fontSize: 12,
        },
        footer: {
          marginTop: 24,
          paddingTop: 10,
          borderTopWidth: 0.5,
          borderTopColor: "#ccc",
          fontSize: 8,
          color: "#888",
        },
      });

      const doc = (
        <Document>
          <Page size="A4" style={styles.page}>
            <View style={styles.header}>
              <View>
                <Text style={styles.title}>TAX SUMMARY {summary.year}</Text>
                <Text style={styles.meta}>{summary.documentNumber}</Text>
                <Text style={styles.meta}>
                  Generated {formatDate(summary.generatedAt)}
                </Text>
              </View>
              <View>
                <Text style={{ fontSize: 14, color: "#008C9C" }}>Cleano</Text>
                <Text style={styles.meta}>Annual Income Statement</Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Recipient</Text>
              <Text>{summary.employee.name}</Text>
              <Text style={styles.meta}>{summary.employee.email}</Text>
              {summary.employee.phone ? (
                <Text style={styles.meta}>{summary.employee.phone}</Text>
              ) : null}
            </View>

            <View style={styles.kpis}>
              <View style={styles.kpiBox}>
                <Text style={styles.kpiLabel}>GROSS INCOME</Text>
                <Text style={styles.kpiValue}>
                  {formatCurrency(summary.grossIncome)}
                </Text>
              </View>
              <View style={styles.kpiBox}>
                <Text style={styles.kpiLabel}>NET INCOME</Text>
                <Text style={styles.kpiValue}>
                  {formatCurrency(summary.netIncome)}
                </Text>
              </View>
              <View style={styles.kpiBox}>
                <Text style={styles.kpiLabel}>
                  EST. TAXES ({(summary.estimatedTaxRate * 100).toFixed(1)}%)
                </Text>
                <Text style={styles.kpiValue}>
                  {formatCurrency(summary.estimatedTaxes)}
                </Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Pay Periods (PAID)</Text>
              <View style={styles.tableHeader}>
                <Text style={styles.col1}>Period</Text>
                <Text style={styles.col2}>Jobs</Text>
                <Text style={styles.col3}>Hours</Text>
                <Text style={styles.col4}>Net</Text>
              </View>
              {summary.payPeriods.map((p) => (
                <View key={p.payoutId} style={styles.tableRow}>
                  <Text style={styles.col1}>
                    {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                  </Text>
                  <Text style={styles.col2}>{p.jobCount}</Text>
                  <Text style={styles.col3}>{p.totalHours.toFixed(1)}</Text>
                  <Text style={styles.col4}>
                    {formatCurrency(p.finalAmount)}
                  </Text>
                </View>
              ))}
              <View style={styles.total}>
                <Text style={styles.col1}>Total</Text>
                <Text style={styles.col2}>{summary.jobsCompleted}</Text>
                <Text style={styles.col3}>
                  {summary.totalHours.toFixed(1)}
                </Text>
                <Text style={styles.col4}>
                  {formatCurrency(summary.netIncome)}
                </Text>
              </View>
            </View>

            <View style={styles.footer}>
              <Text>
                Estimated taxes are an approximation only and not an official
                tax document. Consult a tax professional before filing.
              </Text>
            </View>
          </Page>
        </Document>
      );

      const blob = await pdf(doc).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${summary.documentNumber}.pdf`;
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

  if (loading) {
    return (
      <SectionCard title="My Income" icon={DollarSign}>
        <p className="text-sm text-[#008C9C]/60">Loading income...</p>
      </SectionCard>
    );
  }

  if (error || !data) {
    return (
      <SectionCard title="My Income" icon={DollarSign}>
        <p className="text-sm text-red-600">
          {error ?? "Could not load income data."}
        </p>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-6">
      <SectionCard
        title={`Year-To-Date Earnings (${data.year})`}
        description="Earnings from PAID payouts and estimated taxes."
        icon={DollarSign}
        actions={
          <button className="cl-action-btn" onClick={handleDownload} disabled={downloading}>
            <Download className="w-[13px] h-[13px]" />
            {downloading ? "Generating..." : "Download tax summary"}
          </button>
        }>
        <div className="cl-income-stats-grid">
          <div className="cl-income-mini"><div className="label">Gross YTD</div><div className="val">{formatCurrency(data.grossYTD)}</div></div>
          <div className="cl-income-mini"><div className="label">Net income</div><div className="val">{formatCurrency(data.netYTD)}</div></div>
          <div className="cl-income-mini"><div className="label">Est. taxes ({(data.estimatedTaxRate * 100).toFixed(1)}%)</div><div className="val amber">{formatCurrency(data.estimatedTaxes)}</div></div>
          <div className="cl-income-mini"><div className="label">Cleano deductions</div><div className="val red">{formatCurrency(data.deductionsYTD)}</div></div>
          <div className="cl-income-mini"><div className="label">Adjustments</div><div className="val blue">{formatCurrency(data.adjustmentsYTD)}</div></div>
          <div className="cl-income-mini"><div className="label">Reimbursements</div><div className="val">{formatCurrency(data.reimbursementsYTD)}</div></div>
          <div className="cl-income-mini"><div className="label">Hours worked</div><div className="val">{data.totalHoursYTD.toFixed(1)}h</div></div>
          <div className="cl-income-mini"><div className="label">Jobs completed</div><div className="val">{data.jobsCompletedYTD}</div></div>
        </div>
      </SectionCard>

      <SectionCard
        title="Other Activity"
        description="Pending earnings and withdrawals this year."
        icon={FileText}>
        <div className="cl-income-stats-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <div className="cl-income-mini"><div className="label">Pending pay</div><div className="val">{formatCurrency(data.pendingAmount)}</div></div>
          <div className="cl-income-mini"><div className="label">Withdrawn YTD</div><div className="val">{formatCurrency(data.withdrawnYTD)}</div></div>
          <div className="cl-income-mini"><div className="label">Paid periods</div><div className="val">{data.paidPayoutCount}</div></div>
        </div>
        <div className="cl-form-hint" style={{ marginTop: 14 }}>
          Estimated taxes are an approximation; not an official tax document.
        </div>
      </SectionCard>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
  tone,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  tone?: "amber" | "red" | "blue";
}) {
  const toneClass =
    tone === "red"
      ? "text-red-600"
      : tone === "amber"
        ? "text-amber-700"
        : tone === "blue"
          ? "text-blue-600"
          : "text-[#008C9C]";
  return (
    <div className="rounded-2xl bg-[#008C9C]/5 p-4">
      <p className="text-[10px] uppercase tracking-wider text-[#008C9C]/50 mb-1">
        {label}
      </p>
      <p
        className={`text-xl font-[400] ${toneClass} ${
          highlight ? "font-[500]" : ""
        }`}>
        {value}
      </p>
    </div>
  );
}

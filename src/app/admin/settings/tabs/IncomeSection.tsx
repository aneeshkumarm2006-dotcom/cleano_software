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
                {/* Estimate only — never presented as an official/internal rate. */}
                <Text style={styles.kpiLabel}>EST. TAXES</Text>
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

  // Zero-value cards are dropped rather than rendered as "$0.00" (item 6/11).
  // The headline earnings cards always show so the section never looks broken.
  const earningsStats: StatTile[] = ([
    { label: `Earned ${data.year}`, value: formatCurrency(data.earnedYTD), show: true },
    { label: "Paid out", value: formatCurrency(data.netYTD), show: true },
    { label: "Gross", value: formatCurrency(data.grossYTD), show: data.grossYTD > 0 },
    { label: "Estimated taxes", value: formatCurrency(data.estimatedTaxes), tone: "amber", show: data.estimatedTaxes > 0 },
    { label: "Cleano deductions", value: formatCurrency(data.deductionsYTD), tone: "red", show: data.deductionsYTD !== 0 },
    { label: "Adjustments", value: formatCurrency(data.adjustmentsYTD), tone: "blue", show: data.adjustmentsYTD !== 0 },
    { label: "Reimbursements", value: formatCurrency(data.reimbursementsYTD), show: data.reimbursementsYTD !== 0 },
    { label: "Hours worked", value: `${data.totalHoursYTD.toFixed(1)}h`, show: data.totalHoursYTD > 0 },
    { label: "Jobs completed", value: String(data.jobsCompletedYTD), show: true },
  ] as StatTile[]).filter((s) => s.show);

  const activityStats: StatTile[] = [
    { label: "Pending pay", value: formatCurrency(data.pendingAmount), show: data.pendingAmount > 0 },
    { label: "Withdrawn YTD", value: formatCurrency(data.withdrawnYTD), show: data.withdrawnYTD > 0 },
    { label: "Paid periods", value: String(data.paidPayoutCount), show: data.paidPayoutCount > 0 },
  ].filter((s) => s.show);

  return (
    <div className="space-y-6">
      <SectionCard
        title={`Year-To-Date Earnings (${data.year})`}
        description="Everything you earned for work done this year — paid and pending."
        icon={DollarSign}
        actions={
          <button className="cl-action-btn" onClick={handleDownload} disabled={downloading}>
            <Download className="w-[13px] h-[13px]" />
            {downloading ? "Generating..." : "Download tax summary"}
          </button>
        }>
        <div className="cl-income-stats-grid">
          {earningsStats.map((s) => (
            <div className="cl-income-mini" key={s.label}>
              <div className="label">{s.label}</div>
              <div className={`val${s.tone ? ` ${s.tone}` : ""}`}>{s.value}</div>
            </div>
          ))}
        </div>
        <div className="cl-form-hint" style={{ marginTop: 14 }}>
          Estimated taxes are a rough approximation, not tax advice or an
          official tax document.
        </div>
      </SectionCard>

      {activityStats.length > 0 && (
        <SectionCard
          title="Other Activity"
          description="Pending earnings and withdrawals this year."
          icon={FileText}>
          <div className="cl-income-stats-grid">
            {activityStats.map((s) => (
              <div className="cl-income-mini" key={s.label}>
                <div className="label">{s.label}</div>
                <div className={`val${s.tone ? ` ${s.tone}` : ""}`}>{s.value}</div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

type StatTile = {
  label: string;
  value: string;
  tone?: "amber" | "red" | "blue";
  show: boolean;
};

"use client";

import { useEffect, useState } from "react";
import { BarChart3, SearchX } from "lucide-react";
import { getFaqAnalytics, type FaqAnalyticsDTO } from "@/lib/faqAnalytics";

/**
 * FAQ analytics for the settings tab (CLN-P1-4-17).
 *
 * "Searches that found nothing" is the panel worth reading: every row is a
 * question a customer asked that the FAQ does not answer, which is the list of
 * entries to write next.
 */
export default function FaqAnalyticsPanel() {
  const [data, setData] = useState<FaqAnalyticsDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await getFaqAnalytics();
      if (res.success) setData(res.data);
      else setError(res.error);
    })();
  }, []);

  if (error) {
    return <p style={{ fontSize: 12.5, color: "var(--primary-60)" }}>{error}</p>;
  }
  if (!data) {
    return <p style={{ fontSize: 12.5, color: "var(--primary-60)" }}>Loading FAQ activity…</p>;
  }

  const nothingYet =
    data.pageViews === 0 &&
    data.topQuestions.length === 0 &&
    data.topSearches.length === 0 &&
    data.emptySearches.length === 0;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 4,
        }}>
        <BarChart3 size={14} /> FAQ activity
      </div>
      <p style={{ fontSize: 12, color: "var(--primary-60)", margin: "0 0 14px" }}>
        Last {data.windowDays} days · {data.pageViews.toLocaleString()} FAQ page
        view{data.pageViews === 1 ? "" : "s"} across the website and the customer
        portal.
      </p>

      {nothingYet ? (
        <p style={{ fontSize: 12.5, color: "var(--primary-60)" }}>
          Nothing recorded yet. Opens and searches start appearing here as soon
          as customers use the FAQ.
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}>
          <Panel
            title="Most opened questions"
            // The requirement lists "most-viewed" and "opened most often"
            // separately; on an accordion they are the same event, and saying so
            // beats printing the same numbers under two headings.
            note="A question is counted when a reader expands it."
            rows={data.topQuestions}
            empty="No questions opened yet."
          />
          <Panel
            title="Popular searches"
            note="Counted once per search, not per keystroke."
            rows={data.topSearches}
            empty="No searches yet."
          />
          <Panel
            title="Searches with no results"
            note="Each row is an answer the FAQ is missing."
            rows={data.emptySearches}
            empty="Every search found something."
            icon={<SearchX size={12} />}
          />
        </div>
      )}
    </div>
  );
}

function Panel({
  title,
  note,
  rows,
  empty,
  icon,
}: {
  title: string;
  note: string;
  rows: { label: string; count: number }[];
  empty: string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--primary-10)",
        borderRadius: 12,
        padding: 12,
      }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          fontSize: 12,
          fontWeight: 700,
          marginBottom: 2,
        }}>
        {icon}
        {title}
      </div>
      <p style={{ fontSize: 11, color: "var(--primary-50)", margin: "0 0 10px" }}>{note}</p>
      {rows.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--primary-50)", margin: 0 }}>{empty}</p>
      ) : (
        <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {rows.map((r, i) => (
            <li
              key={`${r.label}-${i}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                fontSize: 12.5,
                padding: "4px 0",
                borderTop: i === 0 ? "none" : "1px solid var(--primary-10)",
              }}>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={r.label}>
                {r.label}
              </span>
              <span style={{ fontWeight: 700, color: "var(--primary)" }}>{r.count}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

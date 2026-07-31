"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";

export interface FaqEntry {
  question: string;
  answer: string;
}

/**
 * Searchable FAQ accordion, shared by the public /faq page and the in-portal
 * /help page so the two can't drift apart.
 *
 * The filtering is client-side over the already-loaded list: the FAQ is a
 * handful of entries in one AppSetting, so a round trip per keystroke would buy
 * nothing. Matching covers the answer text as well as the question — people
 * search for the word in the answer they half-remember ("pets", "parking")
 * more often than for the wording of the question.
 */
export default function FaqAccordion({
  faqs,
  emptyMessage = "No FAQs are available right now. Please contact our office for help.",
}: {
  faqs: FaqEntry[];
  emptyMessage?: string;
}) {
  const [query, setQuery] = useState("");

  const terms = useMemo(
    () => query.toLowerCase().split(/\s+/).filter(Boolean),
    [query]
  );

  const matches = useMemo(() => {
    if (terms.length === 0) return faqs;
    return faqs.filter((f) => {
      const haystack = `${f.question} ${f.answer}`.toLowerCase();
      // Every term must appear somewhere — narrowing as you type, which is what
      // a second word is for.
      return terms.every((t) => haystack.includes(t));
    });
  }, [faqs, terms]);

  if (faqs.length === 0) {
    return (
      <p style={{ textAlign: "center", color: "var(--primary-70)", fontSize: 15 }}>
        {emptyMessage}
      </p>
    );
  }

  const searching = terms.length > 0;

  return (
    <div>
      <div className="cl-faq-search" role="search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search questions and answers…"
          aria-label="Search the FAQ"
          autoComplete="off"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
            <X size={15} />
          </button>
        )}
      </div>

      {/* Announced to screen readers as the list narrows. */}
      <p className="cl-faq-count" aria-live="polite">
        {searching
          ? `${matches.length} of ${faqs.length} question${faqs.length === 1 ? "" : "s"} match`
          : `${faqs.length} question${faqs.length === 1 ? "" : "s"}`}
      </p>

      {matches.length === 0 ? (
        <div className="cl-faq-noresults">
          <p style={{ margin: "0 0 4px", fontWeight: 600, color: "var(--ink)" }}>
            Nothing matched “{query.trim()}”
          </p>
          <p style={{ margin: "0 0 14px", fontSize: 14 }}>
            Try a different word, or get in touch and we&apos;ll answer directly.
          </p>
          <button type="button" className="cl-faq-clear" onClick={() => setQuery("")}>
            Clear search
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {matches.map((f, i) => (
            <details
              // Keyed by question so an open answer stays open as the list
              // filters, instead of the open state sliding onto its neighbour.
              key={`${f.question}-${i}`}
              className="cl-faq-item"
              open={searching && matches.length === 1}>
              <summary className="cl-faq-q">
                <span>{f.question}</span>
                <span className="cl-faq-chevron" aria-hidden="true" />
              </summary>
              <p className="cl-faq-a">{f.answer}</p>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

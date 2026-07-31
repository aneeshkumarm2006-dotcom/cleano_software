"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import type { FaqGroup, FaqLang } from "@/lib/faq";

/**
 * Searchable, categorised FAQ accordion, shared by the public /faq page and the
 * in-portal /help page so the two can't drift apart.
 *
 * The filtering is client-side over the already-loaded list: the FAQ is a few
 * dozen entries at most, so a round trip per keystroke would buy nothing.
 * Matching covers the answer text as well as the question — people search for
 * the word in the answer they half-remember ("pets", "parking") more often than
 * for the wording of the question. While a search is running, categories that
 * match nothing disappear rather than sitting there empty.
 */
export default function FaqAccordion({
  groups,
  emptyMessage = "No FAQs are available right now. Please contact our office for help.",
  lang = "en",
  langHref,
}: {
  groups: FaqGroup[];
  emptyMessage?: string;
  lang?: FaqLang;
  /** Builds the href for the EN/FR switch. Omit to hide the switch. */
  langHref?: (lang: FaqLang) => string;
}) {
  const [query, setQuery] = useState("");

  const total = useMemo(
    () => groups.reduce((n, g) => n + g.items.length, 0),
    [groups]
  );

  const terms = useMemo(
    () => query.toLowerCase().split(/\s+/).filter(Boolean),
    [query]
  );

  const matched = useMemo(() => {
    if (terms.length === 0) return groups;
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter((f) => {
          const haystack = `${f.question} ${f.answer}`.toLowerCase();
          // Every term must appear somewhere — narrowing as you type, which is
          // what a second word is for.
          return terms.every((t) => haystack.includes(t));
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, terms]);

  const matchCount = useMemo(
    () => matched.reduce((n, g) => n + g.items.length, 0),
    [matched]
  );

  const t =
    lang === "fr"
      ? {
          placeholder: "Rechercher dans les questions et réponses…",
          searchLabel: "Rechercher dans la FAQ",
          clear: "Effacer la recherche",
          matches: (m: number, n: number) =>
            `${m} question${n === 1 ? "" : "s"} sur ${n} correspond${m === 1 ? "" : "ent"}`,
          count: (n: number) => `${n} question${n === 1 ? "" : "s"}`,
          nothing: (q: string) => `Aucun résultat pour « ${q} »`,
          tryAgain:
            "Essayez un autre mot, ou écrivez-nous et nous répondrons directement.",
          uncategorised: "Autres questions",
        }
      : {
          placeholder: "Search questions and answers…",
          searchLabel: "Search the FAQ",
          clear: "Clear search",
          matches: (m: number, n: number) =>
            `${m} of ${n} question${n === 1 ? "" : "s"} match`,
          count: (n: number) => `${n} question${n === 1 ? "" : "s"}`,
          nothing: (q: string) => `Nothing matched “${q}”`,
          tryAgain:
            "Try a different word, or get in touch and we'll answer directly.",
          uncategorised: "More questions",
        };

  const langSwitch = langHref ? (
    <div className="cl-faq-lang" role="group" aria-label="Language">
      <Link
        href={langHref("en")}
        className={lang === "en" ? "active" : ""}
        aria-current={lang === "en" ? "true" : undefined}>
        EN
      </Link>
      <Link
        href={langHref("fr")}
        className={lang === "fr" ? "active" : ""}
        aria-current={lang === "fr" ? "true" : undefined}>
        FR
      </Link>
    </div>
  ) : null;

  if (total === 0) {
    return (
      <>
        {langSwitch}
        <p style={{ textAlign: "center", color: "var(--primary-70)", fontSize: 15 }}>
          {emptyMessage}
        </p>
      </>
    );
  }

  const searching = terms.length > 0;
  // With one group and no name there is nothing to organise — don't print a
  // heading over the whole list for the sake of it.
  const showHeadings = groups.length > 1 || groups[0]?.categoryName !== null;

  return (
    <div>
      {langSwitch}

      <div className="cl-faq-search" role="search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.placeholder}
          aria-label={t.searchLabel}
          autoComplete="off"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label={t.clear}>
            <X size={15} />
          </button>
        )}
      </div>

      {/* Announced to screen readers as the list narrows. */}
      <p className="cl-faq-count" aria-live="polite">
        {searching ? t.matches(matchCount, total) : t.count(total)}
      </p>

      {matchCount === 0 ? (
        <div className="cl-faq-noresults">
          <p style={{ margin: "0 0 4px", fontWeight: 600, color: "var(--ink)" }}>
            {t.nothing(query.trim())}
          </p>
          <p style={{ margin: "0 0 14px", fontSize: 14 }}>{t.tryAgain}</p>
          <button type="button" className="cl-faq-clear" onClick={() => setQuery("")}>
            {t.clear}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          {matched.map((g) => (
            <section key={g.categoryId ?? "__ungrouped"}>
              {showHeadings && (
                <h2 className="cl-faq-category">
                  {g.categoryName ?? t.uncategorised}
                </h2>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {g.items.map((f) => (
                  <details
                    // Keyed by id so an open answer stays open as the list
                    // filters, instead of the open state sliding onto its
                    // neighbour.
                    key={f.id}
                    className="cl-faq-item"
                    open={searching && matchCount === 1}>
                    <summary className="cl-faq-q">
                      <span>{f.question}</span>
                      <span className="cl-faq-chevron" aria-hidden="true" />
                    </summary>
                    <p className="cl-faq-a">{f.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Read layer over the FAQ tables, shared by the public `/faq` page, the portal
 * `/help` page and (for the admin editor) the settings tab.
 *
 * Two things this file exists to guarantee:
 *
 *  1. **The pages never go blank.** `getPublishedFaqs` falls back to the legacy
 *     `content.faqs` AppSetting when the tables hold nothing *or when the query
 *     throws* — which is exactly what happens if the code is deployed before
 *     `20260731020000_faq_tables` is applied. Migrations do not run on deploy in
 *     this project, so that ordering mistake has to degrade, not 500.
 *  2. **One source of truth per surface.** `/faq` and `/help` differ only by the
 *     `surface` argument; neither page decides for itself what published means.
 *
 * Not a "use server" module — these are plain server helpers.
 */

import { db } from "@/db";
import { getSetting } from "@/lib/settings";

export type FaqSurface = "public" | "portal";
export type FaqLang = "en" | "fr";

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export interface FaqGroup {
  /** Null id = the ungrouped bucket, always rendered last. */
  categoryId: string | null;
  categoryName: string | null;
  items: FaqItem[];
}

/** Rendered when a French field is blank — never show the reader an empty box. */
function pick(en: string, fr: string | null | undefined, lang: FaqLang): string {
  if (lang === "fr") {
    const t = (fr ?? "").trim();
    if (t) return t;
  }
  return en;
}

/**
 * Published FAQ entries for one surface, grouped by category in admin order.
 *
 * `visibility` maps to the surface: PUBLIC and BOTH on the marketing site,
 * PORTAL and BOTH in the customer portal. DRAFT entries are excluded on both,
 * which is what makes the editor's draft/publish switch mean anything.
 */
export async function getPublishedFaqs(
  surface: FaqSurface,
  lang: FaqLang = "en"
): Promise<FaqGroup[]> {
  try {
    const rows = await db.faq.findMany({
      where: {
        status: "PUBLISHED",
        visibility: surface === "public" ? { in: ["PUBLIC", "BOTH"] } : { in: ["PORTAL", "BOTH"] },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        question: true,
        answer: true,
        questionFr: true,
        answerFr: true,
        categoryId: true,
        category: { select: { id: true, name: true, nameFr: true, sortOrder: true, isActive: true } },
      },
    });

    if (rows.length === 0) return legacyGroups();

    // Group in category order, with the ungrouped bucket last. An inactive
    // category still renders its questions — deactivating a category is about
    // the admin's own list, not about silently unpublishing content.
    const groups = new Map<string, { sortOrder: number; group: FaqGroup }>();
    const ungrouped: FaqItem[] = [];

    for (const r of rows) {
      const item: FaqItem = {
        id: r.id,
        question: pick(r.question, r.questionFr, lang),
        answer: pick(r.answer, r.answerFr, lang),
      };
      if (!r.category) {
        ungrouped.push(item);
        continue;
      }
      const existing = groups.get(r.category.id);
      if (existing) {
        existing.group.items.push(item);
      } else {
        groups.set(r.category.id, {
          sortOrder: r.category.sortOrder,
          group: {
            categoryId: r.category.id,
            categoryName: pick(r.category.name, r.category.nameFr, lang),
            items: [item],
          },
        });
      }
    }

    const out = [...groups.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((g) => g.group);
    if (ungrouped.length > 0) {
      out.push({ categoryId: null, categoryName: null, items: ungrouped });
    }
    return out;
  } catch (e) {
    // Table missing (code ahead of the migration) or the DB is unhappy. Serve
    // the legacy blob rather than an error page.
    console.error("[faq] table read failed; falling back to content.faqs", e);
    return legacyGroups();
  }
}

/**
 * The pre-migration source: the `content.faqs` AppSetting. Deliberately still
 * live. `getSetting` itself falls back to the registry default, so this returns
 * something usable even with no row and no table.
 */
async function legacyGroups(): Promise<FaqGroup[]> {
  const legacy = await getSetting("content.faqs");
  if (!legacy.length) return [];
  return [
    {
      categoryId: null,
      categoryName: null,
      items: legacy.map((f, i) => ({
        id: `legacy-${i}`,
        question: f.question,
        answer: f.answer,
      })),
    },
  ];
}

/** Total questions across groups — used for the "N questions" count. */
export function countFaqs(groups: FaqGroup[]): number {
  return groups.reduce((n, g) => n + g.items.length, 0);
}

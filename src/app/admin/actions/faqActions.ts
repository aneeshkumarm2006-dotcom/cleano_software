"use server";

import { db } from "@/lib/org-db";
import { revalidatePath } from "next/cache";
import { requireOwnerAdmin } from "@/lib/action-guards";
import { logActivity } from "@/lib/activity-log";
import type { FaqStatus, FaqVisibility } from "@prisma/client";

/**
 * Admin CRUD over the FAQ tables (CLN-P1-4-08 questions, 4-09 categories).
 *
 * ⚠️ **Audit logging is hand-written here on purpose.** FAQ edits used to be
 * audited for free because `content.faqs` carried `audit: true` and the settings
 * spine wrote the ActivityLog row (`src/lib/settings/index.ts:144`). Now that
 * edits go to tables, that spine is out of the path — so without the
 * `logActivity` call in every mutation below, `CLN-P1-4-18` (which was fixed in
 * an earlier stage, and whose promise the editor still prints on screen) would
 * silently regress.
 *
 * OWNER/ADMIN only, matching `updateAppSetting`, which is what gated the old
 * editor.
 */

type Result<T> = { success: true; data: T } | { success: false; error: string };

const MAX_TEXT = 8000;
const MAX_NAME = 120;

export interface AdminFaqDTO {
  id: string;
  categoryId: string | null;
  question: string;
  answer: string;
  questionFr: string | null;
  answerFr: string | null;
  status: FaqStatus;
  visibility: FaqVisibility;
  sortOrder: number;
}

export interface AdminFaqCategoryDTO {
  id: string;
  name: string;
  nameFr: string | null;
  sortOrder: number;
  isActive: boolean;
  faqCount: number;
}

export interface AdminFaqDataDTO {
  categories: AdminFaqCategoryDTO[];
  faqs: AdminFaqDTO[];
  /**
   * True when the tables are empty and the public pages are still being served
   * from the legacy `content.faqs` blob — i.e. the migration has not been
   * applied, or it ran against an empty setting. The editor says so rather than
   * looking like the FAQ was wiped.
   */
  usingLegacyFallback: boolean;
}

function text(v: unknown, max = MAX_TEXT): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function optionalText(v: unknown, max = MAX_TEXT): string | null {
  const s = text(v, max);
  return s.length > 0 ? s : null;
}
function isStatus(v: unknown): v is FaqStatus {
  return v === "DRAFT" || v === "PUBLISHED";
}
function isVisibility(v: unknown): v is FaqVisibility {
  return v === "PUBLIC" || v === "PORTAL" || v === "BOTH";
}

/* ─────────────────────────────── reads ─────────────────────────────────── */

export async function getAdminFaqData(): Promise<Result<AdminFaqDataDTO>> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  try {
    const [categories, faqs] = await Promise.all([
      db.faqCategory.findMany({
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: { _count: { select: { faqs: true } } },
      }),
      db.faq.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    ]);

    return {
      success: true,
      data: {
        categories: categories.map((c) => ({
          id: c.id,
          name: c.name,
          nameFr: c.nameFr,
          sortOrder: c.sortOrder,
          isActive: c.isActive,
          faqCount: c._count.faqs,
        })),
        faqs: faqs.map((f) => ({
          id: f.id,
          categoryId: f.categoryId,
          question: f.question,
          answer: f.answer,
          questionFr: f.questionFr,
          answerFr: f.answerFr,
          status: f.status,
          visibility: f.visibility,
          sortOrder: f.sortOrder,
        })),
        usingLegacyFallback: faqs.length === 0,
      },
    };
  } catch (e) {
    console.error("[faq] admin read failed", e);
    return { success: false, error: "Could not load the FAQ. Has the migration been applied?" };
  }
}

/* ──────────────────────────── questions (4-08) ─────────────────────────── */

export async function createFaq(input: {
  question: string;
  answer: string;
  categoryId?: string | null;
}): Promise<Result<AdminFaqDTO>> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  const question = text(input?.question);
  const answer = text(input?.answer);
  if (!question) return { success: false, error: "A question is required" };
  if (!answer) return { success: false, error: "An answer is required" };

  const categoryId = await resolveCategoryId(input?.categoryId);
  if (categoryId === undefined) return { success: false, error: "Category not found" };

  // New questions start as drafts so nothing half-written is live the instant
  // it is typed — publishing is a deliberate second step (4-08).
  const last = await db.faq.findFirst({
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const faq = await db.faq.create({
    data: {
      question,
      answer,
      categoryId,
      status: "DRAFT",
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });

  await audit(guard.userId, "faq.create", faq.id, `FAQ created: ${question}`, {
    question,
    answer,
    categoryId,
  });
  revalidateFaqSurfaces();
  return { success: true, data: toDTO(faq) };
}

export async function updateFaq(
  id: string,
  patch: {
    question?: string;
    answer?: string;
    questionFr?: string | null;
    answerFr?: string | null;
    categoryId?: string | null;
    status?: FaqStatus;
    visibility?: FaqVisibility;
  }
): Promise<Result<AdminFaqDTO>> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };
  if (typeof id !== "string" || !id) return { success: false, error: "Question is required" };

  const existing = await db.faq.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "Question not found" };

  const data: Record<string, unknown> = {};
  if (patch.question !== undefined) {
    const q = text(patch.question);
    if (!q) return { success: false, error: "A question is required" };
    data.question = q;
  }
  if (patch.answer !== undefined) {
    const a = text(patch.answer);
    if (!a) return { success: false, error: "An answer is required" };
    data.answer = a;
  }
  if (patch.questionFr !== undefined) data.questionFr = optionalText(patch.questionFr);
  if (patch.answerFr !== undefined) data.answerFr = optionalText(patch.answerFr);
  if (patch.status !== undefined) {
    if (!isStatus(patch.status)) return { success: false, error: "Unknown status" };
    data.status = patch.status;
  }
  if (patch.visibility !== undefined) {
    if (!isVisibility(patch.visibility)) return { success: false, error: "Unknown visibility" };
    data.visibility = patch.visibility;
  }
  if (patch.categoryId !== undefined) {
    const resolved = await resolveCategoryId(patch.categoryId);
    if (resolved === undefined) return { success: false, error: "Category not found" };
    data.categoryId = resolved;
  }

  if (Object.keys(data).length === 0) {
    return { success: true, data: toDTO(existing) };
  }

  const updated = await db.faq.update({ where: { id }, data });

  // Before/after in the audit row — the settings spine recorded oldValue and
  // newValue, and losing that detail would be a regression of its own.
  await audit(guard.userId, "faq.update", id, `FAQ updated: ${updated.question}`, {
    changed: Object.keys(data),
    before: pickAudit(existing),
    after: pickAudit(updated),
  });
  revalidateFaqSurfaces();
  return { success: true, data: toDTO(updated) };
}

/** Copy a question, as a draft, directly beneath the original (4-08). */
export async function duplicateFaq(id: string): Promise<Result<AdminFaqDTO>> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  const source = await db.faq.findUnique({ where: { id } });
  if (!source) return { success: false, error: "Question not found" };

  const copy = await db.faq.create({
    data: {
      categoryId: source.categoryId,
      question: `${source.question} (copy)`,
      answer: source.answer,
      questionFr: source.questionFr,
      answerFr: source.answerFr,
      visibility: source.visibility,
      // Never inherit PUBLISHED: a duplicate is a starting point, and shipping
      // "… (copy)" to the public site the moment the button is pressed would be
      // the obvious way for this to embarrass someone.
      status: "DRAFT",
      sortOrder: source.sortOrder + 1,
    },
  });

  await audit(guard.userId, "faq.duplicate", copy.id, `FAQ duplicated: ${source.question}`, {
    sourceId: source.id,
  });
  revalidateFaqSurfaces();
  return { success: true, data: toDTO(copy) };
}

export async function deleteFaq(id: string): Promise<Result<{ id: string }>> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  const existing = await db.faq.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "Question not found" };

  await db.faq.delete({ where: { id } });

  // The full text goes into the audit row: this is the only delete in the FAQ
  // system, and the deleted wording is exactly what someone will ask about.
  await audit(guard.userId, "faq.delete", id, `FAQ deleted: ${existing.question}`, {
    question: existing.question,
    answer: existing.answer,
    questionFr: existing.questionFr,
    answerFr: existing.answerFr,
    categoryId: existing.categoryId,
  });
  revalidateFaqSurfaces();
  return { success: true, data: { id } };
}

/** Persist a whole ordering at once (4-08 reorder). */
export async function reorderFaqs(ids: string[]): Promise<Result<{ count: number }>> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };
  if (!Array.isArray(ids) || ids.length === 0) {
    return { success: false, error: "Nothing to reorder" };
  }
  const clean = [...new Set(ids.filter((i) => typeof i === "string" && i))];
  if (clean.length > 1000) return { success: false, error: "Too many items" };

  // Only ids that actually exist — a stale tab must not create phantom rows.
  const known = await db.faq.findMany({
    where: { id: { in: clean } },
    select: { id: true },
  });
  const knownIds = new Set(known.map((k) => k.id));
  const ordered = clean.filter((i) => knownIds.has(i));

  // Interactive form, not `$transaction([...])`: the tenant client rejects the
  // array form on purpose (see org-db.ts) and runs eagerly, so the mapped
  // updates would already have fired before the throw.
  await db.$transaction(async (tx) => {
    for (const [i, id] of ordered.entries()) {
      await tx.faq.update({ where: { id }, data: { sortOrder: i } });
    }
  });

  await audit(guard.userId, "faq.reorder", null, `FAQ order changed (${ordered.length} questions)`, {
    order: ordered,
  });
  revalidateFaqSurfaces();
  return { success: true, data: { count: ordered.length } };
}

/* ──────────────────────────── categories (4-09) ────────────────────────── */

export async function createFaqCategory(
  name: string
): Promise<Result<AdminFaqCategoryDTO>> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  const clean = text(name, MAX_NAME);
  if (!clean) return { success: false, error: "A category name is required" };

  const last = await db.faqCategory.findFirst({
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const category = await db.faqCategory.create({
    data: { name: clean, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });

  await audit(guard.userId, "faq.categoryCreate", category.id, `FAQ category created: ${clean}`, {
    name: clean,
  });
  revalidateFaqSurfaces();
  return {
    success: true,
    data: {
      id: category.id,
      name: category.name,
      nameFr: category.nameFr,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      faqCount: 0,
    },
  };
}

export async function updateFaqCategory(
  id: string,
  patch: { name?: string; nameFr?: string | null; isActive?: boolean }
): Promise<Result<{ id: string }>> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  const existing = await db.faqCategory.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "Category not found" };

  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const n = text(patch.name, MAX_NAME);
    if (!n) return { success: false, error: "A category name is required" };
    data.name = n;
  }
  if (patch.nameFr !== undefined) data.nameFr = optionalText(patch.nameFr, MAX_NAME);
  if (typeof patch.isActive === "boolean") data.isActive = patch.isActive;
  if (Object.keys(data).length === 0) return { success: true, data: { id } };

  await db.faqCategory.update({ where: { id }, data });
  await audit(guard.userId, "faq.categoryUpdate", id, `FAQ category updated: ${existing.name}`, {
    before: { name: existing.name, nameFr: existing.nameFr, isActive: existing.isActive },
    after: data,
  });
  revalidateFaqSurfaces();
  return { success: true, data: { id } };
}

/**
 * Delete a category. The questions inside it are NOT deleted — the FK is
 * `onDelete: SetNull`, so they become uncategorised and both surfaces render
 * them in the trailing group. The count is reported back so the UI can say so.
 */
export async function deleteFaqCategory(
  id: string
): Promise<Result<{ id: string; orphaned: number }>> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  const existing = await db.faqCategory.findUnique({
    where: { id },
    include: { _count: { select: { faqs: true } } },
  });
  if (!existing) return { success: false, error: "Category not found" };

  await db.faqCategory.delete({ where: { id } });
  await audit(
    guard.userId,
    "faq.categoryDelete",
    id,
    `FAQ category deleted: ${existing.name}`,
    { name: existing.name, questionsKept: existing._count.faqs }
  );
  revalidateFaqSurfaces();
  return { success: true, data: { id, orphaned: existing._count.faqs } };
}

export async function reorderFaqCategories(
  ids: string[]
): Promise<Result<{ count: number }>> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };
  if (!Array.isArray(ids) || ids.length === 0) {
    return { success: false, error: "Nothing to reorder" };
  }
  const clean = [...new Set(ids.filter((i) => typeof i === "string" && i))];
  const known = await db.faqCategory.findMany({
    where: { id: { in: clean } },
    select: { id: true },
  });
  const knownIds = new Set(known.map((k) => k.id));
  const ordered = clean.filter((i) => knownIds.has(i));

  await db.$transaction(async (tx) => {
    for (const [i, id] of ordered.entries()) {
      await tx.faqCategory.update({ where: { id }, data: { sortOrder: i } });
    }
  });

  await audit(guard.userId, "faq.categoryReorder", null, "FAQ category order changed", {
    order: ordered,
  });
  revalidateFaqSurfaces();
  return { success: true, data: { count: ordered.length } };
}

/* ─────────────────────────────── helpers ───────────────────────────────── */

type FaqRow = {
  id: string;
  categoryId: string | null;
  question: string;
  answer: string;
  questionFr: string | null;
  answerFr: string | null;
  status: FaqStatus;
  visibility: FaqVisibility;
  sortOrder: number;
};

function toDTO(f: FaqRow): AdminFaqDTO {
  return {
    id: f.id,
    categoryId: f.categoryId,
    question: f.question,
    answer: f.answer,
    questionFr: f.questionFr,
    answerFr: f.answerFr,
    status: f.status,
    visibility: f.visibility,
    sortOrder: f.sortOrder,
  };
}

function pickAudit(f: FaqRow) {
  return {
    question: f.question,
    answer: f.answer,
    questionFr: f.questionFr,
    answerFr: f.answerFr,
    status: f.status,
    visibility: f.visibility,
    categoryId: f.categoryId,
  };
}

/**
 * `undefined` = the caller named a category that does not exist (an error);
 * `null` = deliberately uncategorised.
 */
async function resolveCategoryId(
  raw: string | null | undefined
): Promise<string | null | undefined> {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const found = await db.faqCategory.findUnique({
    where: { id: raw },
    select: { id: true },
  });
  return found ? found.id : undefined;
}

function audit(
  actorId: string,
  action: string,
  targetId: string | null,
  message: string,
  metadata: Record<string, unknown>
) {
  return logActivity({
    category: "ADMIN",
    action,
    actorId,
    targetType: "faq",
    targetId,
    message,
    metadata,
  });
}

/** Both FAQ surfaces render per request, but the admin page is cached. */
function revalidateFaqSurfaces() {
  revalidatePath("/faq");
  revalidatePath("/help");
  revalidatePath("/admin/settings");
}

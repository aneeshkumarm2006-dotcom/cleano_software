import type { TrainingModuleSummary } from "@bookmops/api/v1";

/** "12 min · video and 5 questions". */
export function moduleFacts(m: TrainingModuleSummary): string {
  const parts: string[] = [];
  if (m.durationSeconds) parts.push(`${Math.max(1, Math.round(m.durationSeconds / 60))} min`);
  const what = [m.hasVideo ? "video" : "reading", m.questionCount > 0 ? `${m.questionCount} question${m.questionCount === 1 ? "" : "s"}` : null]
    .filter(Boolean)
    .join(" and ");
  parts.push(what);
  return parts.join(" · ");
}

export const isDone = (m: TrainingModuleSummary) => m.progress.status === "COMPLETED";

/** "100%", from a 0–1 score. */
export const percent = (score: number) => `${Math.round(score * 100)}%`;

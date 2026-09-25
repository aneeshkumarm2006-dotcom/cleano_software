import type { DataSource } from "../source";
import { previewJob, previewMe, previewPast, previewToday, previewUpcoming } from "./fixtures";

/** A little latency, so loading states are seen and designed, not assumed. */
const delay = <T,>(value: T, ms = 350) => new Promise<T>((r) => setTimeout(() => r(value), ms));

export const previewSource: DataSource = {
  me: () => delay(previewMe),
  today: () => delay(previewToday),
  jobs: (scope) => delay({ items: scope === "past" ? previewPast : previewUpcoming, nextCursor: null }),
  job: (id) => delay(previewJob(id)),
};

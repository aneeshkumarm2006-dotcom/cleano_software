import type { ChecklistItemStatus } from "@prisma/client";

export type JobChecklistItemDTO = {
  id: string;
  title: string;
  description: string | null;
  status: ChecklistItemStatus;
  isRequired: boolean;
  sortOrder: number;
  notes: string | null;
  completedAt: Date | null;
  /** Stable group label used to render section headers in the UI. */
  group: "standard" | "addon";
  /** Source template name (used to label add-on sections). */
  templateName: string | null;
};

export type JobChecklistDTO = {
  id: string;
  jobId: string;
  employeeId: string;
  items: JobChecklistItemDTO[];
};

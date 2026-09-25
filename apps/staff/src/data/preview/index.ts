// The development-only data source: every area's sample data, composed. Typed
// as the full DataSource, so an area added to the API client without sample
// data here is a compile error rather than a crash on a simulator.
import type { DataSource } from "../source";
import { previewAvailabilityApi } from "./availability";
import { previewCalendarApi } from "./calendar";
import { previewClockApi } from "./clock";
import { previewDocumentsApi } from "./documents";
import { previewJobsApi } from "./jobs";
import { previewKitApi } from "./kit";
import { previewStrikesApi } from "./strikes";
import { previewTrainingApi } from "./training";

export const previewSource: DataSource = {
  ...previewJobsApi,
  ...previewClockApi,
  ...previewKitApi,
  ...previewAvailabilityApi,
  ...previewCalendarApi,
  ...previewTrainingApi,
  ...previewDocumentsApi,
  ...previewStrikesApi,
};

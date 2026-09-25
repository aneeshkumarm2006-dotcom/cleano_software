// The development-only data source: every area's sample data, composed. Typed
// as the full DataSource, so an area added to the API client without sample
// data here is a compile error rather than a crash on a simulator.
import type { DataSource } from "../source";
import { previewAnnouncementsApi } from "./announcements";
import { previewAvailabilityApi } from "./availability";
import { previewAvailableApi } from "./available";
import { previewCalendarApi } from "./calendar";
import { previewClockApi } from "./clock";
import { previewDevicesApi } from "./devices";
import { previewDocumentsApi } from "./documents";
import { previewIssuesApi } from "./issues";
import { previewJobsApi } from "./jobs";
import { previewKitApi } from "./kit";
import { previewMessagesApi } from "./messages";
import { previewOnMyWayApi } from "./on-my-way";
import { previewPayApi } from "./pay";
import { previewPhotosApi } from "./photos";
import { previewStrikesApi } from "./strikes";
import { previewTrainingApi } from "./training";

export const previewSource: DataSource = {
  ...previewJobsApi,
  ...previewClockApi,
  ...previewDevicesApi,
  ...previewAvailableApi,
  ...previewPayApi,
  ...previewPhotosApi,
  ...previewIssuesApi,
  ...previewOnMyWayApi,
  ...previewMessagesApi,
  ...previewAnnouncementsApi,
  ...previewKitApi,
  ...previewAvailabilityApi,
  ...previewCalendarApi,
  ...previewTrainingApi,
  ...previewDocumentsApi,
  ...previewStrikesApi,
};

// The development-only data source: every area's sample data, composed. Typed
// as the full DataSource, so an area added to the API client without sample
// data here is a compile error rather than a crash on a simulator.
import type { DataSource } from "../source";
import { previewAvailableApi } from "./available";
import { previewClockApi } from "./clock";
import { previewDevicesApi } from "./devices";
import { previewJobsApi } from "./jobs";
import { previewPayApi } from "./pay";

export const previewSource: DataSource = {
  ...previewJobsApi,
  ...previewClockApi,
  ...previewDevicesApi,
  ...previewAvailableApi,
  ...previewPayApi,
};

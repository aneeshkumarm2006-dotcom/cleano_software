// Canonical service / job types offered by the business. These are the exact
// values stored on Job.jobType (see jobs/new/JobTypeSelector). Shared so filters
// and pickers stay in sync with what's actually written to the database.

export const JOB_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "R - Residential", label: "R - Residential" },
  { value: "DEEP - Deep Cleaning", label: "DEEP - Deep Cleaning" },
  { value: "MOVE_IN - Move-in Cleaning", label: "MOVE_IN - Move-in Cleaning" },
  { value: "MOVE_OUT - Move-out Cleaning", label: "MOVE_OUT - Move-out Cleaning" },
  { value: "AIRBNB - Airbnb Cleaning", label: "AIRBNB - Airbnb Cleaning" },
  { value: "C - Commercial", label: "C - Commercial" },
  { value: "PC - Post Construction", label: "PC - Post Construction" },
  { value: "F - Follow-up", label: "F - Follow-up" },
];

export const JOB_TYPE_VALUES = JOB_TYPE_OPTIONS.map((o) => o.value);

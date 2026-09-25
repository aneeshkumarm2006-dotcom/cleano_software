// The vocabularies v1 was released with, frozen.
//
// These are copies, not imports from @bookmops/core or the Prisma schema. If
// v1 imported them, adding a status to the database would silently change
// what the v1 wire can carry. Instead a status added later reaches old builds
// as UNKNOWN (see openEnum), and the day a new value should reach them it is
// added here, deliberately.

export const ROLES = ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD", "EMPLOYEE", "CLIENT", "APPLICANT"] as const;

export const JOB_STATUSES = ["CREATED", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "PAID", "CANCELLED"] as const;

/** Where this cleaner stands on this job right now. */
export const CLOCK_STATES = ["NOT_STARTED", "CLOCKED_IN", "ON_BREAK", "CLOCKED_OUT"] as const;

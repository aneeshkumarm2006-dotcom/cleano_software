// The roles the development-only preview can be signed in as. Only the
// choice lives here, so the sign-in screen can offer it without importing any
// sample data: the people and their data are in ./preview, which a release
// build never contains.
export const PREVIEW_ROLES = [
  { value: "EMPLOYEE", label: "Cleaner" },
  { value: "FIELD_LEAD", label: "Field lead" },
  { value: "OPS_MANAGER", label: "Manager" },
  { value: "ADMIN", label: "Admin" },
] as const;

export type PreviewRole = (typeof PREVIEW_ROLES)[number]["value"];

// Who is signed in to the preview. Development builds only, like everything
// in this folder: the sign-in screen's "Explore with sample data" picks one
// of four people, so each side of the app can be checked on a simulator.
import type { PreviewRole } from "../preview-roles";

export interface PreviewPerson {
  id: string;
  name: string;
  email: string;
}

const PEOPLE: Record<PreviewRole, PreviewPerson> = {
  EMPLOYEE: { id: "preview-cleaner", name: "Amara Diallo", email: "amara@example.com" },
  FIELD_LEAD: { id: "u-sofia", name: "Sofia Martins", email: "sofia@example.com" },
  OPS_MANAGER: { id: "u-nadia", name: "Nadia Rahman", email: "nadia@example.com" },
  ADMIN: { id: "u-marc", name: "Marc Tremblay", email: "marc@example.com" },
};

let current: PreviewRole = "EMPLOYEE";

export function setPreviewRole(role: PreviewRole): void {
  current = role;
}

export function previewRole(): PreviewRole {
  return current;
}

export function previewPerson(): PreviewPerson {
  return PEOPLE[current];
}

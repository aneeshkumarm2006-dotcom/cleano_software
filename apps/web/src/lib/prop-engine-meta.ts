// Client-safe property-engine constants + types. No DB imports.

export type PropertyDef = {
  id: string;
  objectType: string;
  groupName: string;
  label: string;
  internalName: string;
  fieldType: string;
  options: string[];
  isSystem: boolean;
  isRequired: boolean;
  isUnique: boolean;
  visibility: string; // "everyone" | "admin"
  sortOrder: number;
};

export const OBJECT_TYPES = [
  { id: "contact", label: "Contact" },
  { id: "company", label: "Company" },
  { id: "booking", label: "Booking" },
];

export const FIELD_TYPES = [
  { id: "text", label: "Single-line text" },
  { id: "textarea", label: "Multi-line text" },
  { id: "number", label: "Number" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "date", label: "Date picker" },
  { id: "dropdown", label: "Dropdown select" },
  { id: "multi", label: "Multi-select" },
  { id: "checkbox", label: "Checkbox" },
  { id: "user", label: "Cleano user" },
];

export function fieldTypeLabel(id: string): string {
  return FIELD_TYPES.find((f) => f.id === id)?.label ?? id;
}

export const GROUPS = ["Contact info", "Property", "Lead & source", "Booking", "System"];

export const HAS_OPTIONS = new Set(["dropdown", "multi"]);

export function toInternal(label: string): string {
  return (label || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

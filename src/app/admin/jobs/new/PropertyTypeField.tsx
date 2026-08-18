"use client";

// What kind of BUILDING this job is at, for the full-page job form
// (Stage 9 / PDF #11). The modal at admin/jobs/JobModal.tsx carries the same
// control; both post `propertyType`, and the two save paths resolve it
// identically (TODO §4's two-save-paths ⚠️).
//
// Sits with Bedrooms / Bathrooms / Square footage, not with the service picker,
// because that is what it is: a fact about the property, in the same family as
// the room counts. `jobType` — the service — is a separate control in a
// separate section and drives pricing, checklists and permissions. This one
// drives nothing; it is shown to the crew before they arrive.
//
// The blank option is real and is the default. "Not recorded" is the honest
// state for the many jobs booked before this field existed and for an admin
// taking a call who does not know yet, and a pre-selected guess on every new
// job would be worse than a blank.
import { useState } from "react";
import PremiumSelect from "@/components/ui/PremiumSelect";
import {
  PROPERTY_TYPE_HINT,
  PROPERTY_TYPE_LABEL,
  isPropertyType,
  type PropertyType,
} from "@/lib/property-type";

const UNSET = "";

const PROPERTY_TYPE_OPTIONS = [
  { value: UNSET, label: "— Not specified —" },
  {
    value: "APARTMENT_CONDO",
    label: PROPERTY_TYPE_LABEL.APARTMENT_CONDO,
    description: PROPERTY_TYPE_HINT.APARTMENT_CONDO,
  },
  {
    value: "HOUSE",
    label: PROPERTY_TYPE_LABEL.HOUSE,
    description: PROPERTY_TYPE_HINT.HOUSE,
  },
];

interface PropertyTypeFieldProps {
  defaultValue?: string | null;
}

export default function PropertyTypeField({
  defaultValue,
}: PropertyTypeFieldProps) {
  const [value, setValue] = useState<PropertyType | "">(
    isPropertyType(defaultValue) ? defaultValue : UNSET
  );

  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--primary-60)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: 6,
        }}
      >
        Property type
      </label>
      <PremiumSelect
        name="propertyType"
        value={value}
        onChange={(v) => setValue(isPropertyType(v) ? v : UNSET)}
        options={PROPERTY_TYPE_OPTIONS}
        placeholder="— Not specified —"
        size="md"
      />
      <p style={{ marginTop: 6, fontSize: 12, color: "var(--primary-50)" }}>
        {value
          ? PROPERTY_TYPE_HINT[value]
          : "Shown to the crew before they arrive. Doesn't affect the price."}
      </p>
    </div>
  );
}

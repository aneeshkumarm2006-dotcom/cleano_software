"use client";

// Which checklist this job uses, for the full-page job form (Stage 10 / PDF
// #10, step 10.5). The modal at admin/jobs/JobModal.tsx carries the same
// control; both post `checklistTemplateId`, and the two save paths resolve it
// identically (TODO §4's two-save-paths ⚠️).
//
// "Auto" is the default and is where almost every job should stay: the resolver
// already prefers the customer's checklist over the service-type default, so
// pinning is for the exception ("this one visit needs the post-renovation
// list"), not the rule. That is why Auto leads the list and why the hint spells
// out what Auto would do.
//
// Self-contained state, like PropertyTypeField beside it: the page that renders
// it is a server component, and `PremiumSelect` posts through its hidden
// `name`, so there is nothing for the form to hold.

import { useState } from "react";
import PremiumSelect from "@/components/ui/PremiumSelect";
import {
  CHECKLIST_AUTO,
  CHECKLIST_AUTO_LABEL,
  checklistFieldHint,
  checklistFieldOptions,
  type ChecklistTemplateOption,
} from "@/lib/checklist-options";

interface ChecklistTemplateFieldProps {
  templates: ChecklistTemplateOption[];
  defaultValue?: string | null;
}

export default function ChecklistTemplateField({
  templates,
  defaultValue,
}: ChecklistTemplateFieldProps) {
  const [value, setValue] = useState<string>(
    defaultValue && templates.some((t) => t.id === defaultValue)
      ? defaultValue
      : CHECKLIST_AUTO
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
        Checklist
      </label>
      <PremiumSelect
        name="checklistTemplateId"
        value={value}
        onChange={setValue}
        options={checklistFieldOptions(templates)}
        placeholder={CHECKLIST_AUTO_LABEL}
        searchable={templates.length > 8}
        size="md"
      />
      <p style={{ marginTop: 6, fontSize: 12, color: "var(--primary-50)" }}>
        {checklistFieldHint(templates, value)}
      </p>
      {/* A job editing form left open while an admin retires the pinned
          template would otherwise silently reset to Auto on save. Say so. */}
      {defaultValue && !templates.some((t) => t.id === defaultValue) && (
        <p style={{ marginTop: 4, fontSize: 12, color: "var(--warning, #b45309)" }}>
          The checklist this job was pinned to is no longer active. Saving will
          return the job to automatic resolution.
        </p>
      )}
    </div>
  );
}

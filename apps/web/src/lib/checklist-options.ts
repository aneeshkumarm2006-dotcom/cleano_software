// The shape of a checklist-template choice, shared by the two job forms.
//
// PURE — no DB, no framework. Split from ./checklist-options.server.ts for the
// same reason inventory-thresholds is split: the full-page form's field and the
// job modal are CLIENT components, and importing the query module would drag
// PrismaClient into the browser bundle.

export interface ChecklistTemplateOption {
  id: string;
  name: string;
  /** "Mckiernan — 12 Main St", or null when the template is not customer-scoped. */
  scope: string | null;
  /** "Commercial + add-on …" / "All jobs" — the service trigger. */
  trigger: string;
}

/** One-line description under an option in the picker. */
export function checklistOptionHint(option: ChecklistTemplateOption): string {
  return option.scope ? `${option.scope} · ${option.trigger}` : option.trigger;
}

/** The blank value: resolve automatically rather than pinning. */
export const CHECKLIST_AUTO = "";

export const CHECKLIST_AUTO_LABEL = "Auto (recommended)";

export const CHECKLIST_AUTO_HINT =
  "Use the customer's checklist if they have one, otherwise the service-type default.";

/**
 * The option list both job forms render. One function so the modal and the
 * full-page form cannot offer different wording for the same choice.
 */
export function checklistFieldOptions(templates: ChecklistTemplateOption[]) {
  return [
    {
      value: CHECKLIST_AUTO,
      label: CHECKLIST_AUTO_LABEL,
      description: CHECKLIST_AUTO_HINT,
    },
    ...templates.map((t) => ({
      value: t.id,
      label: t.name,
      description: checklistOptionHint(t),
      keywords: t.scope ?? undefined,
    })),
  ];
}

/** The line under the picker, given what is currently selected. */
export function checklistFieldHint(
  templates: ChecklistTemplateOption[],
  value: string
): string {
  const picked = templates.find((t) => t.id === value);
  return picked
    ? `Pinned — the cleaner gets "${picked.name}" on this job whatever the customer or service rules say.`
    : "Resolved automatically when the cleaner opens the job. Pin a template only to override that.";
}

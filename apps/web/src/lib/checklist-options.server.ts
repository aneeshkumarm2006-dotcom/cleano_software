// The query behind the checklist-template picker offered on the two job forms
// (Stage 10 / PDF #10, step 10.5).
//
// Server-side but NOT a `"use server"` module, so the full-page job form (a
// server component) can call it during render while the modal reaches it
// through the thin action in src/app/admin/actions/getJobChecklistOptions.ts.
// One query shape, one label rule, two callers — which is the whole point: the
// modal and the full-page form are the repo's two independent job-save paths
// (see TODO §4's two-save-paths warning) and every Stage 8/9/10 field has had
// to land in both.
//
// The labels and the option list live in ./checklist-options.ts, which is pure
// so the client components can share them.

import { db } from "@/lib/org-db";
import { describeScope, describeTrigger } from "@/lib/checklist-triggers";
import type { ChecklistTemplateOption } from "@/lib/checklist-options";

/**
 * Active templates, named and described, for a "pin this job to one checklist"
 * control.
 *
 * INACTIVE templates are excluded deliberately. Deactivating is how a template
 * is retired, and the resolver honours that for a pinned template too — so
 * offering one here would let an admin pin a job to a list that resolution then
 * refuses to use.
 */
export async function listChecklistTemplateOptions(): Promise<
  ChecklistTemplateOption[]
> {
  const templates = await db.checklistTemplate.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      jobType: true,
      addOnName: true,
      clientId: true,
      clientAddressId: true,
      client: { select: { name: true } },
      clientAddress: { select: { label: true, address: true } },
    },
  });

  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    scope: describeScope({
      clientId: t.clientId,
      clientAddressId: t.clientAddressId,
      clientName: t.client?.name,
      addressLabel: t.clientAddress?.address ?? t.clientAddress?.label,
    }),
    trigger: describeTrigger({ jobType: t.jobType, addOnName: t.addOnName }),
  }));
}

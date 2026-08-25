"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { resolveTemplateScope } from "@/lib/checklist-scope.server";

interface ChecklistItemInput {
  title: string;
  description?: string | null;
  isRequired?: boolean;
  sortOrder?: number;
}

interface UpdateChecklistTemplateInput {
  id: string;
  name: string;
  description?: string | null;
  jobType?: string | null;
  addOnName?: string | null;
  /** Customer scope (Stage 10 / PDF #10). Null = not customer-specific. */
  clientId?: string | null;
  /** One location of that customer. Requires `clientId`. */
  clientAddressId?: string | null;
  isActive?: boolean;
  items: ChecklistItemInput[];
}

export async function updateChecklistTemplate(
  input: UpdateChecklistTemplateInput
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    if (!input.id || !input.name?.trim()) {
      return { success: false, error: "Template id and name are required" };
    }

    const scope = await resolveTemplateScope(input);
    if ("error" in scope) return { success: false, error: scope.error };

    const filtered = (input.items || []).filter((it) => it.title?.trim());

    await db.$transaction([
      db.checklistTemplate.update({
        where: { id: input.id },
        data: {
          name: input.name.trim(),
          description: input.description?.trim() || null,
          jobType: input.jobType?.trim() || null,
          addOnName: input.addOnName?.trim() || null,
          // Written unconditionally, including back to null: the editor always
          // sends the current state of both pickers, so clearing the customer
          // is a real edit ("this list is generic after all") and must not be
          // read as "field omitted, leave it alone".
          clientId: scope.clientId,
          clientAddressId: scope.clientAddressId,
          isActive: input.isActive ?? true,
        },
      }),
      db.checklistTemplateItem.deleteMany({
        where: { templateId: input.id },
      }),
      db.checklistTemplateItem.createMany({
        data: filtered.map((it, idx) => ({
          templateId: input.id,
          title: it.title.trim(),
          description: it.description?.trim() || null,
          isRequired: it.isRequired ?? true,
          sortOrder: it.sortOrder ?? idx,
        })),
      }),
    ]);

    revalidatePath("/admin/settings");
    return { success: true };
  } catch (error) {
    console.error("Error updating checklist template:", error);
    return { success: false, error: "Failed to update template" };
  }
}

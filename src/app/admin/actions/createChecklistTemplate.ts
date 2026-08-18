"use server";

import { db } from "@/db";
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

interface CreateChecklistTemplateInput {
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

export async function createChecklistTemplate(
  input: CreateChecklistTemplateInput
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    if (!input.name?.trim()) {
      return { success: false, error: "Template name is required" };
    }

    const scope = await resolveTemplateScope(input);
    if ("error" in scope) return { success: false, error: scope.error };

    const filtered = (input.items || []).filter((it) => it.title?.trim());

    const tpl = await db.checklistTemplate.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        jobType: input.jobType?.trim() || null,
        addOnName: input.addOnName?.trim() || null,
        clientId: scope.clientId,
        clientAddressId: scope.clientAddressId,
        isActive: input.isActive ?? true,
        items: {
          create: filtered.map((it, idx) => ({
            title: it.title.trim(),
            description: it.description?.trim() || null,
            isRequired: it.isRequired ?? true,
            sortOrder: it.sortOrder ?? idx,
          })),
        },
      },
    });

    revalidatePath("/admin/settings");
    return { success: true, templateId: tpl.id };
  } catch (error) {
    console.error("Error creating checklist template:", error);
    return { success: false, error: "Failed to create template" };
  }
}

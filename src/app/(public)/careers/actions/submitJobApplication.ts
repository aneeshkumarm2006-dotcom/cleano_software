"use server";

import { db } from "@/db";
import { sendApplicantConfirmation, sendAdminNewApplication } from "@/lib/email";

export interface JobApplicationInput {
  name: string;
  email: string;
  phone?: string;
  cityArea?: string;
  availability?: string;
  experience?: string;
  hasTransport?: boolean | null;
  resumeUrl?: string | null;
  notes?: string;
}

export async function submitJobApplication(input: JobApplicationInput) {
  try {
    const name = input.name?.trim();
    const email = input.email?.trim().toLowerCase();
    if (!name) return { success: false, error: "Name is required" };
    if (!email || !email.includes("@")) {
      return { success: false, error: "A valid email is required" };
    }
    if (!input.phone?.trim()) {
      return { success: false, error: "Phone number is required" };
    }

    const application = await db.jobApplication.create({
      data: {
        name,
        email,
        phone: input.phone?.trim() || null,
        cityArea: input.cityArea?.trim() || null,
        availability: input.availability?.trim() || null,
        experience: input.experience?.trim() || null,
        hasTransport:
          typeof input.hasTransport === "boolean" ? input.hasTransport : null,
        resumeUrl: input.resumeUrl?.trim() || null,
        notes: input.notes?.trim() || null,
        source: "careers_page",
      },
    });

    sendApplicantConfirmation({ to: email, applicantName: name }).catch((e) =>
      console.error("applicant confirmation email", e)
    );
    sendAdminNewApplication({
      applicationId: application.id,
      name,
      email,
      phone: input.phone?.trim() ?? null,
      cityArea: input.cityArea?.trim() ?? null,
      hasTransport:
        typeof input.hasTransport === "boolean" ? input.hasTransport : null,
      resumeUrl: input.resumeUrl?.trim() ?? null,
    }).catch((e) => console.error("admin application alert email", e));

    return { success: true, applicationId: application.id };
  } catch (error) {
    console.error("Error submitting job application:", error);
    return { success: false, error: "Failed to submit application" };
  }
}

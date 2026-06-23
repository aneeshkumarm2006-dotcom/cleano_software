"use server";

import { db } from "@/db";
import { sendApplicantConfirmation, sendAdminNewApplication } from "@/lib/email";

export interface JobApplicationInput {
  // Personal
  firstName: string;
  lastName: string;
  gender?: string;
  dateOfBirth?: string;
  email: string;
  phone?: string;
  addressStreet?: string;
  addressLine2?: string;
  cityArea?: string;
  province?: string;
  postalCode?: string;
  country?: string;
  // Transportation
  hasTransport?: boolean | null;
  driversLicense?: string;
  hasInsurance?: boolean | null;
  insuranceDetails?: string;
  // Availability
  availableDays?: string[];
  preferredHours?: string;
  earliestStart?: string;
  // Experience
  yearsExperience?: string;
  experienceTypes?: string[];
  experience?: string;
  resumeUrl?: string | null;
  // About you
  whyCleano?: string;
  hasConviction?: boolean | null;
  convictionDetails?: string;
  hearAbout?: string;
  referrerName?: string;
  // References
  ref1Name?: string;
  ref1Relationship?: string;
  ref1Phone?: string;
  ref2Name?: string;
  ref2Relationship?: string;
  ref2Phone?: string;
  // Consent
  backgroundConsent?: boolean;
  consentDate?: string;
}

const s = (v?: string | null) => (v?.trim() ? v.trim() : null);

export async function submitJobApplication(input: JobApplicationInput) {
  try {
    const firstName = input.firstName?.trim();
    const lastName = input.lastName?.trim();
    const email = input.email?.trim().toLowerCase();
    if (!firstName || !lastName) {
      return { success: false, error: "First and last name are required" };
    }
    if (!email || !email.includes("@")) {
      return { success: false, error: "A valid email is required" };
    }
    if (!input.phone?.trim()) {
      return { success: false, error: "Phone number is required" };
    }
    if (!input.backgroundConsent) {
      return { success: false, error: "Background-check consent is required" };
    }

    const name = `${firstName} ${lastName}`;
    const days = input.availableDays ?? [];
    // Readable summary for the legacy `availability` column / list view.
    const availability =
      [days.join(", "), s(input.preferredHours)].filter(Boolean).join(" · ") ||
      null;

    const application = await db.jobApplication.create({
      data: {
        name,
        firstName,
        lastName,
        gender: s(input.gender),
        dateOfBirth: s(input.dateOfBirth),
        email,
        phone: s(input.phone),
        addressStreet: s(input.addressStreet),
        addressLine2: s(input.addressLine2),
        cityArea: s(input.cityArea),
        province: s(input.province),
        postalCode: s(input.postalCode),
        country: s(input.country),
        hasTransport:
          typeof input.hasTransport === "boolean" ? input.hasTransport : null,
        driversLicense: s(input.driversLicense),
        hasInsurance:
          typeof input.hasInsurance === "boolean" ? input.hasInsurance : null,
        insuranceDetails: s(input.insuranceDetails),
        availability,
        availableDays: days,
        preferredHours: s(input.preferredHours),
        earliestStart: s(input.earliestStart),
        yearsExperience: s(input.yearsExperience),
        experienceTypes: input.experienceTypes ?? [],
        experience: s(input.experience),
        resumeUrl: s(input.resumeUrl),
        whyCleano: s(input.whyCleano),
        hasConviction:
          typeof input.hasConviction === "boolean" ? input.hasConviction : null,
        convictionDetails: s(input.convictionDetails),
        hearAbout: s(input.hearAbout),
        referrerName: s(input.referrerName),
        ref1Name: s(input.ref1Name),
        ref1Relationship: s(input.ref1Relationship),
        ref1Phone: s(input.ref1Phone),
        ref2Name: s(input.ref2Name),
        ref2Relationship: s(input.ref2Relationship),
        ref2Phone: s(input.ref2Phone),
        backgroundConsent: !!input.backgroundConsent,
        consentDate: s(input.consentDate),
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
      phone: s(input.phone),
      cityArea: s(input.cityArea),
      hasTransport:
        typeof input.hasTransport === "boolean" ? input.hasTransport : null,
      resumeUrl: s(input.resumeUrl),
    }).catch((e) => console.error("admin application alert email", e));

    return { success: true, applicationId: application.id };
  } catch (error) {
    console.error("Error submitting job application:", error);
    return { success: false, error: "Failed to submit application" };
  }
}

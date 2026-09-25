import { BOOKING_PHOTO_UPLOADER_LABEL } from "@/lib/booking-deposit";
import type { JobPhotoKind } from "@/lib/job-photos";

export type JobPhotoDTO = {
  id: string;
  jobId: string;
  /**
   * NULL when the CUSTOMER uploaded this from the booking flow (Stage 11 / PDF
   * #9) — there is no staff `User` behind a guest booking.
   */
  employeeId: string | null;
  /**
   * Always a name to render. Falls back to `BOOKING_PHOTO_UPLOADER_LABEL` for a
   * customer upload, so the three galleries that print this string stay unchanged
   * and none of them has to invent its own wording for "nobody on staff".
   */
  employeeName: string;
  url: string;
  caption: string | null;
  /**
   * What this photo documents (item 1). NOT NULL in the database with a
   * GENERAL default, so this is always one of the four — a gallery never has to
   * handle "unfiled" as a fifth case.
   */
  kind: JobPhotoKind;
  createdAt: Date;
  canDelete: boolean;
};

export { BOOKING_PHOTO_UPLOADER_LABEL };

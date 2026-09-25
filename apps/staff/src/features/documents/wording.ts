// The legal wording of signing, copied word for word from the web's signing
// view (apps/web/src/app/admin/documents/[id]/DocumentSigningView.tsx). A
// signature means what these sentences say, so they must not drift from the
// web's: change them there and here together, or not at all.

/** The box the person ticks. On the web the title is in bold. */
export const agreementParts = (title: string) =>
  ["I have read and agree to the terms set out in ", title, ", and I am signing this document electronically."] as const;

export const DRAW_PROMPT = "Draw your signature in the box below.";

export const RECORDED_NOTE = "Your signature and a timestamp will be recorded.";

export const notSignable = (status: string) => `This document is ${status.toLowerCase()} and can no longer be signed.`;

/**
 * What the web shows for a document the office gave neither text nor a file:
 * a plain acknowledgement of the title and version.
 */
export function acknowledgement(title: string, version: string, description: string | null): string[] {
  return [
    `This acknowledgement confirms that the undersigned has received, read, and understood the contents of ${title} (v${version}).`,
    `${description ? `${description} ` : ""}By signing below, you agree to comply with all policies and procedures described herein, and understand that violation may result in disciplinary action up to and including termination.`,
    "This document supersedes all prior versions. Questions may be directed to the HR department at any time.",
  ];
}

export const ACKNOWLEDGEMENT_POINTS = [
  "I have read the document in its entirety.",
  "I understand my obligations under these terms.",
  "I am signing voluntarily and electronically.",
] as const;

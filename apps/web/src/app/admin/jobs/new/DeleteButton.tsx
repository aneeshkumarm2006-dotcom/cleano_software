"use client";

import { useFormStatus } from "react-dom";
import Button from "@/components/ui/Button";

/**
 * Archive, as a button INSIDE the job form rather than a form of its own.
 *
 * It used to render `<form action={archiveJobAction}>` nested inside the page's
 * `<form action={saveJob}>`. HTML forbids that: the parser drops the inner
 * start tag and the inner `</form>` then closes the OUTER form, so the browser
 * and React disagreed about where the form ended — three console errors and a
 * hydration mismatch that made React rebuild the whole tree on every edit-mode
 * visit. React 19's `formAction` does the same job with valid markup: the
 * button submits the surrounding form's data (which already carries the hidden
 * `jobId`) to a different action.
 *
 * `formNoValidate` because this form has required fields and archiving must not
 * be blocked by an incomplete one. `useFormStatus().action` tells the two
 * submissions apart, so pressing Save no longer spins this button.
 *
 * It is rendered LAST in the footer and moved back to the left with `order` —
 * see the note at the callsite. A form's default button (the one Enter presses
 * from any text field) is the first submit button in tree order, and while this
 * one held that spot, Enter archived the job instead of saving it, `formNoValidate`
 * carrying it straight past the required fields. The confirm below is the second
 * half of that: this is the one control on the page that destroys the booking
 * being edited, and every other destructive control in the admin asks first.
 */
export default function DeleteButton({
  action,
}: {
  action: (formData: FormData) => void | Promise<void>;
}) {
  const { pending, action: submittingAction } = useFormStatus();
  const archiving = pending && submittingAction === action;

  return (
    <Button
      type="submit"
      formAction={action}
      formNoValidate
      variant="destructive"
      disabled={pending}
      // preventDefault on a submit button's click cancels the submission, so a
      // cancelled confirm leaves the admin exactly where they were, with every
      // edit they had typed still in the form.
      onClick={(e) => {
        if (
          !window.confirm(
            "Archive this job? It leaves Jobs, the calendar and the cleaners' schedules, and can be restored from Jobs → Archived. Unsaved edits on this form are discarded."
          )
        ) {
          e.preventDefault();
        }
      }}>
      {archiving ? (
        <span className="flex items-center gap-2">
          <svg
            className="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Archiving...
        </span>
      ) : (
        // Says "Archive" because that is now what it does. This form used to
        // run a hard delete; it routes through the audited soft delete, so the
        // job lands in Jobs → Archived and is restorable from there.
        <>Archive Job</>
      )}
    </Button>
  );
}


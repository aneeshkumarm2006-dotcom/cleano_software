// Error boundaries are per route segment, so re-exporting the page is not
// enough — without this file /cleaners/settings would still fall through to
// Next's bare error screen while /admin/settings showed the friendly one.
//
// The directive is required even though this file is only a re-export: Next
// checks the boundary MODULE itself, and without it the route 500s on every
// request with "error.tsx must be a Client Component".
"use client";

export { default } from "@/app/admin/settings/error";

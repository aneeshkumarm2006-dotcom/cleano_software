"use client";

/**
 * How the full-page job form pre-fills itself when a saved address is picked
 * (new photo/address fixes, items 2 + 3).
 *
 * ## Why an event and not props
 *
 * `/admin/jobs/new` is a server-rendered `<form>` whose fields are UNCONTROLLED
 * — `defaultValue` on plain inputs, submitted by the browser. `ClientNameField`
 * has always pre-filled its siblings by finding them with
 * `document.querySelector('input[name=…]')` and setting `.value`, because there
 * is no shared React state to lift into: the two components are not in a
 * provider and the form is not a controlled component. That works for every
 * plain input, which is why the address, apt and postal code have always
 * pre-filled that way.
 *
 * It does NOT work for `PropertyTypeField`. That one keeps its selection in
 * `useState` and renders `PremiumSelect`, whose submitted value comes from a
 * hidden input React owns — poke it and React overwrites the poke on its next
 * render, so the form would show one building type and submit another. A
 * silently wrong submission is worse than no pre-fill at all.
 *
 * So the picker announces, and the fields that own React state listen. One
 * event on `window`, one payload, no provider threaded through a 1,400-line
 * server component.
 *
 * The numeric size fields (bedrooms, baths, half baths, square feet) are plain
 * uncontrolled inputs and keep using the DOM path — they are listed here as
 * well so both halves of a pre-fill are described in one place.
 */

import type { PropertyType } from "@/lib/property-type";

/** The event `ClientNameField` fires whenever the chosen address changes. */
export const ADDRESS_PREFILL_EVENT = "cleano:address-prefill";

export interface AddressPrefillDetail {
  /**
   * The building type to select, or null to clear it.
   *
   * Null is a real instruction, not "leave it alone": switching from an address
   * recorded as a HOUSE to one with nothing recorded must clear the field, or
   * the second address inherits the first's answer and the job saves a fact
   * nobody entered about it.
   */
  propertyType: PropertyType | null;
}

/** Announce a pre-fill. No-op on the server, where there is no window. */
export function announceAddressPrefill(detail: AddressPrefillDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AddressPrefillDetail>(ADDRESS_PREFILL_EVENT, { detail })
  );
}

/** Subscribe to pre-fills. Returns the unsubscribe function for `useEffect`. */
export function onAddressPrefill(
  handler: (detail: AddressPrefillDetail) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    handler((e as CustomEvent<AddressPrefillDetail>).detail);
  };
  window.addEventListener(ADDRESS_PREFILL_EVENT, listener);
  return () => window.removeEventListener(ADDRESS_PREFILL_EVENT, listener);
}

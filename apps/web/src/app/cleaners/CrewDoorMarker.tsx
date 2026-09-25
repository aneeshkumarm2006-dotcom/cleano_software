"use client";

import { useEffect } from "react";

/**
 * Marks this device as belonging to the CREW door.
 *
 * The server also sets an httpOnly `cleano_door` cookie at sign-in, but that
 * only helps people who sign in again — and cookies get evicted on iOS, which
 * is often the very reason the session lapsed. Writing the hint on every crew
 * app load means anyone who simply OPENS the app while still signed in is
 * covered: when their session later expires and the installed shortcut
 * launches "/", the customer login sees this hint and forwards them to
 * /cleanos/login instead of stranding them on the customer door.
 *
 * localStorage (unlike the session cookie) survives the session expiring.
 */
export default function CrewDoorMarker() {
  useEffect(() => {
    try {
      if (localStorage.getItem("cleano_door") !== "cleaner") {
        localStorage.setItem("cleano_door", "cleaner");
      }
    } catch {
      // Private mode / storage disabled — the visible "crew app" link on the
      // customer login is the fallback.
    }
  }, []);

  return null;
}

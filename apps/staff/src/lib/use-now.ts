import { useEffect, useState } from "react";

/**
 * The current time, re-read every `intervalMs`. The shared rules never read
 * the clock themselves (see @bookmops/core); the screens do, here, and pass it
 * in — so "starts in 48 min" counts down while the screen is open.
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Navigation, Check } from "lucide-react";
import { markOnMyWay, updateOnMyWayLocation } from "./onMyWay";
import { fmtTime } from "@/lib/time";

/**
 * Best-effort geolocation. Resolves with coords if the user grants access,
 * otherwise resolves undefined. Never rejects — pressing "On my way" must
 * never be blocked by geolocation.
 */
export function getCoords(): Promise<{ lat: number; lng: number } | undefined> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(undefined),
      { timeout: 8000, maximumAge: 60000 }
    );
  });
}

interface OnMyWayButtonProps {
  jobId: string;
  onMyWayAt: string | null;
}

export default function OnMyWayButton({ jobId, onMyWayAt }: OnMyWayButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [since, setSince] = useState<string | null>(onMyWayAt);

  // Basic live tracking (#10): while marked on-the-way and this screen is open,
  // push the cleaner's location every 30s. The server stops accepting updates
  // once the cleaner clocks in, so tracking ends automatically on arrival.
  useEffect(() => {
    if (!since) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    let cancelled = false;
    const push = async () => {
      const coords = await getCoords();
      if (!cancelled && coords) {
        await updateOnMyWayLocation(jobId, coords).catch(() => {});
      }
    };
    push();
    const timer = setInterval(push, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [since, jobId]);

  async function handleClick() {
    setLoading(true);
    try {
      const coords = await getCoords();
      const res = await markOnMyWay(jobId, coords);
      if (res.success) {
        setSince(res.onMyWayAt ?? new Date().toISOString());
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  if (since) {
    return (
      <span className="cl-jd-otw-done">
        <Check size={13} />
        On my way · since {fmtTime(since)}
      </span>
    );
  }

  return (
    <button className="cl-jd-otw" onClick={handleClick} disabled={loading}>
      <Navigation size={13} />
      {loading ? "Sharing…" : "On my way"}
    </button>
  );
}

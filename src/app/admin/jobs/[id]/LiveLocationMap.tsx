"use client";

import React, { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin } from "lucide-react";
import { getJobLiveLocation, type LiveLocation } from "./liveLocation";

/** Poll cadence for the admin live view (#10). */
const POLL_MS = 18_000;

/** Teal pin marker drawn as a divIcon so we avoid Leaflet's missing default
 *  marker-image issue (same approach as the sales map). */
const cleanerIcon = L.divIcon({
  html: `<div style="
    width: 20px; height: 20px;
    background: #008C9C;
    border: 3px solid white;
    border-radius: 50%;
    box-shadow: 0 2px 6px rgba(0,0,0,0.35);
  "></div>`,
  className: "",
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom(), { animate: true });
  }, [lat, lng, map]);
  return null;
}

function agoLabel(iso: string, now: number): string {
  const secs = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `updated ${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `updated ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `updated ${hrs}h ago`;
}

interface Props {
  jobId: string;
  /** Server-rendered starting point; may be null if nothing shared yet. */
  initial: LiveLocation | null;
}

export default function LiveLocationMap({ jobId, initial }: Props) {
  const [loc, setLoc] = useState<LiveLocation | null>(initial);
  const [now, setNow] = useState<number>(() => Date.now());
  const stopped = useRef(false);

  // Poll the admin-gated action for the latest point. Stops itself once the
  // server reports the window is closed (null location) — e.g. after clock-in
  // or when the setting is turned off.
  useEffect(() => {
    stopped.current = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      try {
        const res = await getJobLiveLocation(jobId);
        if (stopped.current) return;
        if (res.success) {
          if (res.location) setLoc(res.location);
          else if (timer) {
            // Window closed — stop polling; keep last known point on screen.
            clearInterval(timer);
            timer = null;
          }
        }
      } catch {
        /* transient error — keep last point, retry next tick */
      }
    };

    timer = setInterval(tick, POLL_MS);
    return () => {
      stopped.current = true;
      if (timer) clearInterval(timer);
    };
  }, [jobId]);

  // Tick the "updated Xs ago" label once a second.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!loc) return null;

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 340,
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid var(--primary-10)",
        background: "var(--primary-5)",
      }}
    >
      <MapContainer
        center={[loc.lat, loc.lng]}
        zoom={15}
        scrollWheelZoom={false}
        dragging={false}
        doubleClickZoom={false}
        zoomControl={false}
        attributionControl={false}
        style={{ height: 170, width: "100%" }}
        className="z-0"
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
        />
        <Marker position={[loc.lat, loc.lng]} icon={cleanerIcon} />
        <Recenter lat={loc.lat} lng={loc.lng} />
      </MapContainer>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "6px 10px",
          fontSize: 11.5,
          fontWeight: 600,
          color: "var(--primary-60)",
        }}
      >
        <span>{agoLabel(loc.at, now)}</span>
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            color: "#166534",
            textDecoration: "none",
          }}
        >
          <MapPin size={12} />
          Open in Maps
        </a>
      </div>
    </div>
  );
}

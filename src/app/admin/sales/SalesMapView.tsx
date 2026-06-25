"use client";

import React, { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { salesTypeColor, salesTypeLabel } from "./salesTypes";

function createColoredIcon(color: string) {
  return L.divIcon({
    html: `<div style="
      width: 24px; height: 24px;
      background: ${color};
      border: 3px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    "></div>`,
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
  });
}

interface SalesArea {
  id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  address: string | null;
  notes: string | null;
  date: string;
  createdAt: string;
}

interface SalesMapViewProps {
  salesAreas: SalesArea[];
  onPinClick?: (area: SalesArea) => void;
}

function FitBounds({ salesAreas }: { salesAreas: SalesArea[] }) {
  const map = useMap();

  useEffect(() => {
    if (salesAreas.length === 0) return;

    if (salesAreas.length === 1) {
      map.setView(
        [salesAreas[0].latitude, salesAreas[0].longitude],
        13
      );
    } else {
      const bounds = L.latLngBounds(
        salesAreas.map((a) => [a.latitude, a.longitude])
      );
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [salesAreas, map]);

  return null;
}

export default function SalesMapView({
  salesAreas,
  onPinClick,
}: SalesMapViewProps) {
  const defaultCenter: [number, number] = [45.5017, -73.5673]; // Montreal

  return (
    <div className="relative">
      <MapContainer
        center={defaultCenter}
        zoom={11}
        scrollWheelZoom={false}
        style={{ height: "420px", width: "100%" }}
        className="sl-map z-0">
        <TileLayer
          attribution="&copy; OpenStreetMap &copy; CARTO"
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
        />
        <FitBounds salesAreas={salesAreas} />
        {salesAreas.map((area) => {
          const color = salesTypeColor(area.type);
          return (
            <Marker
              key={area.id}
              position={[area.latitude, area.longitude]}
              icon={createColoredIcon(color)}
              eventHandlers={{ click: () => onPinClick?.(area) }}>
              <Popup>
                <div className="text-sm">
                  <p className="font-[500] text-[#008C9C]">{area.name}</p>
                  <p className="text-xs font-[600] uppercase tracking-wide" style={{ color }}>
                    {salesTypeLabel(area.type)}
                  </p>
                  {area.address && (
                    <p className="text-xs text-gray-400 mt-1">{area.address}</p>
                  )}
                  {area.notes && (
                    <p className="text-xs text-gray-500 mt-1">{area.notes}</p>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}

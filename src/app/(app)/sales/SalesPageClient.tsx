"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import SalesAreaModal from "./SalesAreaModal";
import LandingPageManager from "./LandingPageManager";
import CampaignManager from "./CampaignManager";
import {
  MapPin,
  Plus,
  Globe,
  Megaphone,
  Eye,
  DollarSign,
} from "lucide-react";
import {
  SALES_TYPE_LABELS,
  salesTypeColor,
  salesTypeLabel,
} from "./salesTypes";

// Dynamic import for map (SSR disabled — Leaflet requires browser APIs)
const SalesMapView = dynamic(() => import("./SalesMapView"), {
  ssr: false,
  loading: () => (
    <div style={{ height: 400, background: "var(--primary-5)", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ fontSize: 13, color: "var(--primary-50)" }}>Loading map…</p>
    </div>
  ),
});

type TabView = "map" | "landing-pages" | "campaigns";

const TABS: Array<{ id: TabView; label: string; icon: React.ReactNode }> = [
  { id: "map", label: "Sales Map", icon: <MapPin size={15} /> },
  { id: "landing-pages", label: "Landing Pages", icon: <Globe size={15} /> },
  { id: "campaigns", label: "Campaigns", icon: <Megaphone size={15} /> },
];

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

interface LandingPage {
  id: string;
  title: string;
  slug: string;
  content: string;
  ctaText: string;
  ctaLink: string;
  isPublished: boolean;
  campaignId: string | null;
  campaignName: string | null;
  totalVisits: number;
  recentVisits: number;
  createdAt: string;
}

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  status: string;
  budget: number;
  spent: number;
  startDate: string | null;
  endDate: string | null;
  channel: string | null;
  notes: string | null;
  landingPageCount: number;
  createdAt: string;
}

interface Stats {
  totalAreas: number;
  totalPages: number;
  publishedPages: number;
  totalCampaigns: number;
  activeCampaigns: number;
  totalBudget: number;
  totalSpent: number;
  totalVisits: number;
}

interface SalesPageClientProps {
  salesAreas: SalesArea[];
  landingPages: LandingPage[];
  campaigns: Campaign[];
  stats: Stats;
}

export default function SalesPageClient({
  salesAreas,
  landingPages,
  campaigns,
  stats,
}: SalesPageClientProps) {
  const [activeTab, setActiveTab] = useState<TabView>("map");
  const [showAreaModal, setShowAreaModal] = useState(false);
  const [editingArea, setEditingArea] = useState<SalesArea | null>(null);

  return (
    <div className="admin-font stack-24">
      <header className="stack-8">
        <p className="eyebrow">Marketing</p>
        <h1 className="display">Sales &amp; <em>marketing.</em></h1>
        <p className="subtitle">
          Service zones, landing pages, and campaign performance in one place.
        </p>
      </header>

      <div className="astat-grid">
        <div className="astat">
          <div className="astat-head"><span>Service areas</span><span className="astat-icon"><MapPin size={15} /></span></div>
          <div className="astat-value">{stats.totalAreas}</div>
          <div className="astat-delta">zones mapped</div>
        </div>
        <div className="astat">
          <div className="astat-head"><span>Page visits</span><span className="astat-icon"><Eye size={15} /></span></div>
          <div className="astat-value">{stats.totalVisits.toLocaleString()}</div>
          <div className="astat-delta">{stats.publishedPages} published pages</div>
        </div>
        <div className="astat">
          <div className="astat-head"><span>Active campaigns</span><span className="astat-icon"><Megaphone size={15} /></span></div>
          <div className="astat-value">{stats.activeCampaigns}</div>
          <div className="astat-delta">of {stats.totalCampaigns} total</div>
        </div>
        <div className="astat">
          <div className="astat-head"><span>Budget spent</span><span className="astat-icon"><DollarSign size={15} /></span></div>
          <div className="astat-value">${stats.totalSpent.toLocaleString()}</div>
          <div className="astat-delta">of ${stats.totalBudget.toLocaleString()} budget</div>
        </div>
      </div>

      <div className="atabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`atab${activeTab === tab.id ? " active" : ""}`}
            onClick={() => setActiveTab(tab.id)}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {tab.icon}
              {tab.label}
            </span>
          </button>
        ))}
      </div>

      {activeTab === "map" && (
        <div>
          <div className="sl-map-bar">
            <div className="sl-legend">
              {Object.entries(SALES_TYPE_LABELS).map(([key, label]) => (
                <span key={key} className="sl-legend-item">
                  <span className="sl-legend-dot" style={{ background: salesTypeColor(key) }} />
                  {label}
                </span>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => { setEditingArea(null); setShowAreaModal(true); }}>
              <Plus size={14} /> New area
            </button>
          </div>

          <div className="sl-map-wrap">
            <SalesMapView
              salesAreas={salesAreas}
              onPinClick={(area) => { setEditingArea(area); setShowAreaModal(true); }}
            />
          </div>

          {salesAreas.length > 0 && (
            <div className="sl-area-grid">
              {salesAreas.map((area) => {
                const color = salesTypeColor(area.type);
                return (
                  <button
                    key={area.id}
                    type="button"
                    className="jcard sl-area-card"
                    onClick={() => { setEditingArea(area); setShowAreaModal(true); }}>
                    <div className="sl-area-top">
                      <span className="jcard-client">{area.name}</span>
                      <span
                        className="pill"
                        style={{ background: "transparent", color, boxShadow: `inset 0 0 0 1px ${color}55` }}>
                        <span className="pill-dot" style={{ background: color }} />
                        {salesTypeLabel(area.type)}
                      </span>
                    </div>
                    {area.address && (
                      <div className="sl-area-addr"><MapPin size={13} /> {area.address}</div>
                    )}
                    {area.notes ? (
                      <div className="sl-area-notes">{area.notes}</div>
                    ) : (
                      <div className="sl-area-notes" style={{ color: "var(--primary-50)" }}>
                        {new Date(area.date).toLocaleDateString("en-US")}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === "landing-pages" && (
        <LandingPageManager landingPages={landingPages} campaigns={campaigns} />
      )}

      {activeTab === "campaigns" && (
        <CampaignManager campaigns={campaigns} />
      )}

      <SalesAreaModal
        isOpen={showAreaModal}
        onClose={() => { setShowAreaModal(false); setEditingArea(null); }}
        editingArea={editingArea}
      />
    </div>
  );
}

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
  TrendingUp,
  Pencil,
} from "lucide-react";

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

const TYPE_LABELS: Record<string, string> = {
  DOOR_KNOCK: "Door Knock",
  FLYER_DROP: "Flyer Drop",
  REFERRAL: "Referral",
  ONLINE_AD: "Online Ad",
  SOCIAL_MEDIA: "Social Media",
  OTHER: "Other",
};

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
        <h1 className="display">Sales & Marketing</h1>
        <p style={{ fontSize: 14, color: "var(--primary-60)" }}>
          Manage sales areas, landing pages, and marketing campaigns.
        </p>
      </header>

      <div className="astat-grid">
        <div className="astat">
          <div className="astat-head"><span>Sales Areas</span><span className="astat-icon"><MapPin size={15} /></span></div>
          <div className="astat-value">{stats.totalAreas}</div>
        </div>
        <div className="astat">
          <div className="astat-head"><span>Page Visits</span><span className="astat-icon"><Eye size={15} /></span></div>
          <div className="astat-value">{stats.totalVisits}</div>
          <div className="astat-delta">{stats.publishedPages} published pages</div>
        </div>
        <div className="astat">
          <div className="astat-head"><span>Active Campaigns</span><span className="astat-icon"><Megaphone size={15} /></span></div>
          <div className="astat-value">{stats.activeCampaigns}</div>
          <div className="astat-delta">of {stats.totalCampaigns} total</div>
        </div>
        <div className="astat">
          <div className="astat-head"><span>Budget spent</span><span className="astat-icon"><DollarSign size={15} /></span></div>
          <div className="astat-value">${stats.totalSpent.toFixed(0)}</div>
          <div className="astat-delta">of ${stats.totalBudget.toFixed(0)} budget</div>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div className="col-client">Sales Areas Map</div>
              <div className="col-client-sub">Color-coded pins showing sales activity across areas</div>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => { setEditingArea(null); setShowAreaModal(true); }}>
              <Plus size={14} /> Add Pin
            </button>
          </div>

          <div className="atable-wrap" style={{ padding: 0, overflow: "hidden" }}>
            <SalesMapView
              salesAreas={salesAreas}
              onPinClick={(area) => { setEditingArea(area); setShowAreaModal(true); }}
            />
          </div>

          {salesAreas.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--primary-50)" }}>
                All Areas ({salesAreas.length})
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
                {salesAreas.map((area) => (
                  <button
                    key={area.id}
                    type="button"
                    className="jcard"
                    style={{ textAlign: "left", cursor: "pointer", width: "100%" }}
                    onClick={() => { setEditingArea(area); setShowAreaModal(true); }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span className="col-client" style={{ fontSize: 14 }}>{area.name}</span>
                          <span style={{ display: "inline-block", background: "var(--primary-5)", color: "var(--primary-70)", fontSize: 10, fontWeight: 600, borderRadius: 20, padding: "2px 8px" }}>
                            {TYPE_LABELS[area.type] || area.type}
                          </span>
                        </div>
                        {area.address && <div className="col-client-sub" style={{ marginTop: 4 }}>{area.address}</div>}
                        <div className="col-client-sub" style={{ marginTop: 2 }}>{new Date(area.date).toLocaleDateString("en-US")}</div>
                      </div>
                      <Pencil size={13} style={{ color: "var(--primary-30)", flexShrink: 0, marginTop: 2 }} />
                    </div>
                  </button>
                ))}
              </div>
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

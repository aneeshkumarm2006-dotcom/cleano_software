"use client";

import { useState } from "react";
import {
  User as UserIcon,
  Percent,
  DollarSign,
  Briefcase,
  CreditCard,
  Boxes,
  Package,
  Star,
  Shield,
  Truck,
  MapPin,
  ListChecks,
  Calendar as CalendarIcon,
  CalendarClock,
  CalendarOff,
  GraduationCap,
  FileSignature,
  Bell,
  HeartHandshake,
  Wallet,
  Users,
  Globe,
  Globe2,
  HardHat,
} from "lucide-react";
import ProfileTab from "./tabs/ProfileTab";
import TaxSettingsTab from "./tabs/TaxSettingsTab";
import PricingRulesTab from "./tabs/PricingRulesTab";
import JobTypesTab from "./tabs/JobTypesTab";
import PaymentTypesTab from "./tabs/PaymentTypesTab";
import InventoryRulesTab from "./tabs/InventoryRulesTab";
import KitTemplatesTab from "./tabs/KitTemplatesTab";
import MultipliersTab from "./tabs/MultipliersTab";
import RolesTab from "./tabs/RolesTab";
import SuppliersTab from "./tabs/SuppliersTab";
import InventoryLocationsTab from "./tabs/InventoryLocationsTab";
import ServiceAreasTab from "./tabs/ServiceAreasTab";
import ChecklistTemplatesTab from "./tabs/ChecklistTemplatesTab";
import AvailabilityTab from "./tabs/AvailabilityTab";
import ClosuresTab from "./tabs/ClosuresTab";
import TrainingTab, {
  TrainingModuleRecord,
} from "./tabs/TrainingTab";
import DocumentsTab, {
  DocumentRecord,
  UserOption,
} from "./tabs/DocumentsTab";
import NotificationsTab, { NotificationSettingRow } from "./tabs/NotificationsTab";
import RetentionTab from "./tabs/RetentionTab";
import SchedulingTab from "./tabs/SchedulingTab";
import PaymentsTab from "./tabs/PaymentsTab";
import CustomerTab from "./tabs/CustomerTab";
import GeneralTab from "./tabs/GeneralTab";
import ProviderTab from "./tabs/ProviderTab";
import WebsiteTab from "./tabs/WebsiteTab";
import {
  SettingsUser,
  AppSettingRecord,
  ProductRecord,
  KitTemplateRecord,
  InventoryRuleRecord,
  SupplierRecord,
  InventoryLocationRecord,
  ChecklistTemplateRecord,
  ServiceAreaRecord,
} from "./types";

interface SettingsClientProps {
  user: SettingsUser;
  isAdmin: boolean;
  appSettings: AppSettingRecord[];
  products: ProductRecord[];
  kitTemplates: KitTemplateRecord[];
  inventoryRules: InventoryRuleRecord[];
  suppliers: SupplierRecord[];
  inventoryLocations: InventoryLocationRecord[];
  checklistTemplates: ChecklistTemplateRecord[];
  trainingModules: TrainingModuleRecord[];
  documents: DocumentRecord[];
  users: UserOption[];
  serviceAreas: ServiceAreaRecord[];
  notificationSettings: NotificationSettingRow[];
}

type TabId =
  | "profile"
  | "availability"
  | "closures"
  | "tax"
  | "pricing"
  | "jobTypes"
  | "paymentTypes"
  | "inventoryRules"
  | "kitTemplates"
  | "checklistTemplates"
  | "training"
  | "documents"
  | "multipliers"
  | "roles"
  | "suppliers"
  | "inventoryLocations"
  | "serviceAreas"
  | "general"
  | "customer"
  | "provider"
  | "payments"
  | "scheduling"
  | "website"
  | "retention"
  | "notifications";

interface TabDef {
  id: TabId;
  label: string;
  icon: typeof UserIcon;
  adminOnly?: boolean;
}

const TABS: TabDef[] = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "availability", label: "Availability", icon: CalendarIcon },
  { id: "closures", label: "Closed Dates", icon: CalendarOff, adminOnly: true },
  { id: "tax", label: "Tax", icon: Percent, adminOnly: true },
  { id: "pricing", label: "Pricing Rules", icon: DollarSign, adminOnly: true },
  { id: "jobTypes", label: "Job Types", icon: Briefcase, adminOnly: true },
  {
    id: "paymentTypes",
    label: "Payment Types",
    icon: CreditCard,
    adminOnly: true,
  },
  {
    id: "inventoryRules",
    label: "Inventory Rules",
    icon: Boxes,
    adminOnly: true,
  },
  {
    id: "kitTemplates",
    label: "Kit Templates",
    icon: Package,
    adminOnly: true,
  },
  {
    id: "checklistTemplates",
    label: "Checklist Templates",
    icon: ListChecks,
    adminOnly: true,
  },
  {
    id: "training",
    label: "Training",
    icon: GraduationCap,
    adminOnly: true,
  },
  {
    id: "documents",
    label: "Documents",
    icon: FileSignature,
    adminOnly: true,
  },
  { id: "multipliers", label: "Multipliers", icon: Star, adminOnly: true },
  { id: "roles", label: "Roles", icon: Shield, adminOnly: true },
  { id: "suppliers", label: "Suppliers", icon: Truck, adminOnly: true },
  {
    id: "inventoryLocations",
    label: "Inventory Locations",
    icon: MapPin,
    adminOnly: true,
  },
  {
    id: "serviceAreas",
    label: "Service Areas",
    icon: MapPin,
    adminOnly: true,
  },
  { id: "general", label: "General", icon: Globe, adminOnly: true },
  { id: "customer", label: "Customer", icon: Users, adminOnly: true },
  { id: "provider", label: "Provider", icon: HardHat, adminOnly: true },
  { id: "payments", label: "Payments & Fees", icon: Wallet, adminOnly: true },
  {
    id: "scheduling",
    label: "Scheduling",
    icon: CalendarClock,
    adminOnly: true,
  },
  { id: "website", label: "Website & FAQ", icon: Globe2, adminOnly: true },
  {
    id: "retention",
    label: "Retention",
    icon: HeartHandshake,
    adminOnly: true,
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    adminOnly: true,
  },
];

export default function SettingsClient({
  user,
  isAdmin,
  appSettings,
  products,
  kitTemplates,
  inventoryRules,
  suppliers,
  inventoryLocations,
  checklistTemplates,
  trainingModules,
  documents,
  users,
  serviceAreas,
  notificationSettings,
}: SettingsClientProps) {
  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);
  const [activeTab, setActiveTab] = useState<TabId>("profile");

  return (
    <div className="admin-font stack-24">
      <header className="stack-8">
        <p className="eyebrow">Admin</p>
        <h1 className="display">Settings</h1>
        <p style={{ fontSize: 14, color: "var(--primary-60)" }}>Manage your account and application configuration.</p>
      </header>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <aside style={{ width: 220, flexShrink: 0 }}>
          <div style={{ background: "var(--primary-5)", borderRadius: 16, padding: 6, display: "flex", flexDirection: "column", gap: 2 }}>
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 14px",
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    background: active ? "var(--primary)" : "transparent",
                    color: active ? "#fff" : "var(--primary-70)",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.15s",
                  }}>
                  <Icon strokeWidth={1.9} size={15} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </aside>

        <section style={{ flex: 1, minWidth: 0 }}>
          {activeTab === "profile" && <ProfileTab user={user} />}
          {activeTab === "availability" && <AvailabilityTab />}
          {activeTab === "closures" && isAdmin && (
            <ClosuresTab settings={appSettings} />
          )}
          {activeTab === "tax" && isAdmin && (
            <TaxSettingsTab settings={appSettings} />
          )}
          {activeTab === "pricing" && isAdmin && (
            <PricingRulesTab settings={appSettings} />
          )}
          {activeTab === "jobTypes" && isAdmin && (
            <JobTypesTab settings={appSettings} />
          )}
          {activeTab === "paymentTypes" && isAdmin && (
            <PaymentTypesTab settings={appSettings} />
          )}
          {activeTab === "inventoryRules" && isAdmin && (
            <InventoryRulesTab
              products={products}
              rules={inventoryRules}
            />
          )}
          {activeTab === "kitTemplates" && isAdmin && (
            <KitTemplatesTab
              products={products}
              kitTemplates={kitTemplates}
            />
          )}
          {activeTab === "checklistTemplates" && isAdmin && (
            <ChecklistTemplatesTab
              templates={checklistTemplates}
              settings={appSettings}
            />
          )}
          {activeTab === "training" && isAdmin && (
            <TrainingTab modules={trainingModules} />
          )}
          {activeTab === "documents" && isAdmin && (
            <DocumentsTab documents={documents} users={users} />
          )}
          {activeTab === "multipliers" && isAdmin && (
            <MultipliersTab settings={appSettings} />
          )}
          {activeTab === "roles" && isAdmin && <RolesTab />}
          {activeTab === "suppliers" && isAdmin && (
            <SuppliersTab products={products} suppliers={suppliers} />
          )}
          {activeTab === "inventoryLocations" && isAdmin && (
            <InventoryLocationsTab
              products={products}
              locations={inventoryLocations}
            />
          )}
          {activeTab === "serviceAreas" && isAdmin && (
            <ServiceAreasTab serviceAreas={serviceAreas} />
          )}
          {activeTab === "general" && isAdmin && (
            <GeneralTab settings={appSettings} />
          )}
          {activeTab === "customer" && isAdmin && (
            <CustomerTab settings={appSettings} />
          )}
          {activeTab === "provider" && isAdmin && (
            <ProviderTab settings={appSettings} />
          )}
          {activeTab === "payments" && isAdmin && (
            <PaymentsTab settings={appSettings} />
          )}
          {activeTab === "scheduling" && isAdmin && (
            <SchedulingTab settings={appSettings} />
          )}
          {activeTab === "website" && isAdmin && (
            <WebsiteTab settings={appSettings} />
          )}
          {activeTab === "retention" && isAdmin && (
            <RetentionTab settings={appSettings} />
          )}
          {activeTab === "notifications" && isAdmin && (
            <NotificationsTab settings={notificationSettings} />
          )}
        </section>
      </div>
    </div>
  );
}


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
  Tags,
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
import CalendarLabelsTab from "./tabs/CalendarLabelsTab";
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
  | "calendarLabels"
  | "website"
  | "retention"
  | "notifications";

interface TabDef {
  id: TabId;
  label: string;
  icon: typeof UserIcon;
  adminOnly?: boolean;
}

// One-line description shown in the panel header above each tab's content.
const TAB_SUBTITLES: Record<TabId, string> = {
  profile: "Your dashboard, performance, income and personal alerts.",
  availability: "When you can be scheduled.",
  closures: "Block days or time ranges for the whole team.",
  tax: "GST / QST rates and registration numbers.",
  pricing: "Per-unit pricing, add-ons and specialty packages.",
  jobTypes: "Define the kinds of jobs you offer.",
  paymentTypes: "Customer-facing labels for each payment method.",
  inventoryRules: "Per-job usage and refill thresholds.",
  kitTemplates: "Bundled product sets for each visit type.",
  checklistTemplates: "Reusable checklists applied to matching jobs.",
  training: "Modules, videos and quizzes for your team.",
  documents: "Documents your team must read and sign.",
  multipliers: "Pay multiplier at each rating band.",
  roles: "What each role can access.",
  suppliers: "Vendors and their product pricing.",
  inventoryLocations: "Where inventory is stored and stocked.",
  serviceAreas: "Postal prefixes you serve and travel fees.",
  general: "Currency and core configuration.",
  customer: "Referrals, reviews and customer-facing rules.",
  provider: "What providers can see and do.",
  payments: "Cancellation fees and gift cards.",
  scheduling: "Lead times, timeouts and recurring horizon.",
  calendarLabels: "Tag each job type on the calendar.",
  website: "Custom domain, FAQ and embed codes.",
  retention: "Save offers in the check-in email.",
  notifications: "Per-channel notification preferences.",
};

// Sidebar groupings (label → ordered tab ids).
const TAB_GROUPS: { label: string; ids: TabId[] }[] = [
  { label: "You", ids: ["profile", "availability"] },
  { label: "Operations", ids: ["closures", "jobTypes", "checklistTemplates", "serviceAreas"] },
  { label: "Money", ids: ["tax", "pricing", "paymentTypes", "multipliers", "payments"] },
  { label: "Inventory", ids: ["inventoryRules", "kitTemplates", "suppliers", "inventoryLocations"] },
  { label: "Team", ids: ["training", "documents", "roles"] },
  {
    label: "Configuration",
    ids: ["general", "customer", "provider", "scheduling", "calendarLabels", "website", "retention", "notifications"],
  },
];

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
  {
    id: "calendarLabels",
    label: "Calendar Labels",
    icon: Tags,
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
  const [activeTab, setActiveTab] = useState<TabId>("profile");

  // Canonical 1–26 numbering follows the TABS order; groups only render their
  // admin-visible tabs (non-admins see "You" only).
  const tabNumber = (id: TabId) =>
    String(TABS.findIndex((t) => t.id === id) + 1).padStart(2, "0");
  const visibleGroups = TAB_GROUPS.map((g) => ({
    label: g.label,
    ids: g.ids.filter((id) => {
      const tab = TABS.find((t) => t.id === id);
      return tab && (!tab.adminOnly || isAdmin);
    }),
  })).filter((g) => g.ids.length > 0);

  const activeDef = TABS.find((t) => t.id === activeTab);
  const isReadOnly = activeTab === "roles";

  return (
    <div className="admin-font stack-24">
      <header className="stack-8">
        <p className="eyebrow">Admin</p>
        <h1 className="display">Settings</h1>
        <p style={{ fontSize: 15, color: "var(--primary-70)" }}>Manage your account and application configuration.</p>
      </header>

      <div className="set-layout">
        <nav className="set-menu">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <div className="set-menu-label">{group.label}</div>
              {group.ids.map((id) => {
                const tab = TABS.find((t) => t.id === id)!;
                const Icon = tab.icon;
                const active = activeTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`smenu-item${active ? " active" : ""}`}
                    onClick={() => setActiveTab(id)}>
                    <Icon strokeWidth={1.9} size={16} />
                    <span>{tab.label}</span>
                    <span className="smenu-num">{tabNumber(id)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <section style={{ flex: 1, minWidth: 0 }}>
          {activeDef && (
            <div className="set-panel-head">
              <div>
                <h2>{activeDef.label}</h2>
                <p>{TAB_SUBTITLES[activeTab]}</p>
              </div>
              {activeDef.adminOnly && (
                <span className="set-ro-tag">
                  <Shield strokeWidth={2} size={13} />
                  {isReadOnly ? "Read-only" : "Admin only"}
                </span>
              )}
            </div>
          )}
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
          {activeTab === "calendarLabels" && isAdmin && (
            <CalendarLabelsTab settings={appSettings} />
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


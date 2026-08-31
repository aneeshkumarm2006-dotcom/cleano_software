"use client";

import { useEffect, useState } from "react";
import InstallAppCard from "@/components/InstallAppCard";
import {
  User as UserIcon,
  Percent,
  DollarSign,
  Briefcase,
  CreditCard,
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
  Target,
  Users,
  Globe,
  Globe2,
  HardHat,
  Tags,
  FileText,
  ClipboardList,
} from "lucide-react";
import ProfileTab from "./tabs/ProfileTab";
import TaxSettingsTab from "./tabs/TaxSettingsTab";
import PricingRulesTab from "./tabs/PricingRulesTab";
import JobTypesTab from "./tabs/JobTypesTab";
import PaymentTypesTab from "./tabs/PaymentTypesTab";
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
import BudgetsTab from "./tabs/BudgetsTab";
import GeneralTab from "./tabs/GeneralTab";
import ProviderTab from "./tabs/ProviderTab";
import WebsiteTab from "./tabs/WebsiteTab";
import ServiceContentTab from "./tabs/ServiceContentTab";
import BookingPageTab from "./tabs/BookingPageTab";
import {
  SettingsUser,
  SettingsSectionFailure,
  AppSettingRecord,
  ProductRecord,
  KitTemplateRecord,
  SupplierRecord,
  InventoryLocationRecord,
  ChecklistTemplateRecord,
  ServiceAreaRecord,
} from "./types";
import type {
  TransactionRow,
  BudgetRow,
  BudgetCategoryOption,
} from "../finances/types";

interface SettingsClientProps {
  user: SettingsUser;
  isAdmin: boolean;
  /**
   * Which tab to open on, from `?tab=` on the URL.
   *
   * The active tab is local state and always has been, so until now every link
   * into Settings landed on Profile and the person following it had to find the
   * tab themselves — fine from the sidebar, useless for "your prices are still
   * the defaults → fix them here". Resolved against TABS below rather than
   * trusted: an unknown id, or an admin-only tab requested by somebody who is
   * not an admin, falls back to Profile.
   */
  initialTab?: string;
  appSettings: AppSettingRecord[];
  products: ProductRecord[];
  kitTemplates: KitTemplateRecord[];
  suppliers: SupplierRecord[];
  inventoryLocations: InventoryLocationRecord[];
  checklistTemplates: ChecklistTemplateRecord[];
  trainingModules: TrainingModuleRecord[];
  documents: DocumentRecord[];
  users: UserOption[];
  serviceAreas: ServiceAreaRecord[];
  notificationSettings: NotificationSettingRow[];
  transactions: TransactionRow[];
  budgets: BudgetRow[];
  budgetCategories: BudgetCategoryOption[];
  /**
   * Sections whose server-side query failed. Empty on a healthy page. The tab
   * that depends on a failed section renders its empty state plus an inline
   * notice, rather than the whole page rendering an error screen.
   */
  failedSections?: SettingsSectionFailure[];
}

type TabId =
  | "profile"
  | "availability"
  | "closures"
  | "tax"
  | "pricing"
  | "jobTypes"
  | "serviceContent"
  | "bookingPage"
  | "paymentTypes"
  | "kitTemplates"
  | "checklistTemplates"
  | "training"
  | "documents"
  | "multipliers"
  | "budgets"
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
  serviceContent: "What's included text + graphic shown per service on booking.",
  bookingPage:
    "Which fields the public booking page shows, in what order, per service.",
  paymentTypes: "Customer-facing labels for each payment method.",
  kitTemplates: "Bundled product sets for each visit type.",
  checklistTemplates: "Reusable checklists applied to matching jobs.",
  training: "Modules, videos and quizzes for your team.",
  documents: "Documents your team must read and sign.",
  multipliers: "Pay multiplier at each rating band.",
  budgets:
    "Your budget categories, plus monthly budgets per category vs actual spend.",
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

// Which server-side section each tab's content comes from. Only used to point
// a degraded section at the tabs it actually broke, so a failed
// `trainingModule` query says so on Training and nowhere else. Tabs backed by
// `appSettings` are omitted individually — that section feeds most config tabs,
// so it is matched by key below rather than listed twenty times.
const TAB_DATA_DEPS: Partial<Record<TabId, string[]>> = {
  kitTemplates: ["kitTemplates", "products"],
  suppliers: ["suppliers", "products"],
  inventoryLocations: ["inventoryLocations", "products"],
  checklistTemplates: ["checklistTemplates"],
  training: ["trainingModules"],
  documents: ["documents", "users"],
  serviceAreas: ["serviceAreas"],
  budgets: ["transactions", "budgets", "budgetCategories"],
  notifications: ["notificationSettings"],
};

/** Tabs that render straight from the `appSettings` rows. */
const APP_SETTING_TABS: TabId[] = [
  "closures",
  "tax",
  "pricing",
  "jobTypes",
  "serviceContent",
  "bookingPage",
  "paymentTypes",
  "checklistTemplates",
  "multipliers",
  "general",
  "customer",
  "provider",
  "payments",
  "scheduling",
  "calendarLabels",
  "website",
  "retention",
];

// Sidebar groupings (label → ordered tab ids).
const TAB_GROUPS: { label: string; ids: TabId[] }[] = [
  { label: "You", ids: ["profile", "availability"] },
  { label: "Operations", ids: ["closures", "jobTypes", "serviceContent", "bookingPage", "checklistTemplates", "serviceAreas"] },
  { label: "Money", ids: ["tax", "pricing", "paymentTypes", "multipliers", "budgets", "payments"] },
  { label: "Inventory", ids: ["kitTemplates", "suppliers", "inventoryLocations"] },
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
    id: "serviceContent",
    label: "What's Included",
    icon: FileText,
    adminOnly: true,
  },
  {
    id: "bookingPage",
    label: "Booking Page",
    icon: ClipboardList,
    adminOnly: true,
  },
  {
    id: "paymentTypes",
    label: "Payment Types",
    icon: CreditCard,
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
  { id: "budgets", label: "Budgets", icon: Target, adminOnly: true },
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
  initialTab,
  appSettings,
  products,
  kitTemplates,
  suppliers,
  inventoryLocations,
  checklistTemplates,
  trainingModules,
  documents,
  users,
  serviceAreas,
  notificationSettings,
  transactions,
  budgets,
  budgetCategories,
  failedSections = [],
}: SettingsClientProps) {
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const wanted = TABS.find((t) => t.id === initialTab);
    return wanted && (!wanted.adminOnly || isAdmin) ? wanted.id : "profile";
  });

  // Budget categories are edited in-page (Settings → Budgets) and their count is
  // rendered out here in the sidebar, so the list is held one level above the
  // tab. `router.refresh()` alone left both stale: `revalidatePath` only marks
  // the route dirty, and this page re-queries every settings section, so the
  // repaint arrives long after the "added." message does. The tab applies each
  // change here immediately and the server payload takes over the moment it
  // lands (identity check: props only change when a new payload arrives).
  const [categories, setCategories] =
    useState<BudgetCategoryOption[]>(budgetCategories);
  useEffect(() => {
    setCategories(budgetCategories);
  }, [budgetCategories]);

  // The number beside each sidebar item is a REAL record count for that section.
  // (It used to be the tab's zero-padded ORDINAL — "04", "05", "07" — which read
  // like a count of records and was wrong every time.)
  //
  // Only sections backed by a list of records get a number; config sections
  // (Tax, Pricing, General, …) are single settings forms with nothing to count,
  // so they show nothing rather than a fake number. Counts come straight from the
  // props the server page already passes, so they update whenever records change.
  const tabCounts: Partial<Record<TabId, number>> = {
    kitTemplates: kitTemplates.length,
    checklistTemplates: checklistTemplates.length,
    training: trainingModules.length,
    documents: documents.length,
    // The active CATEGORIES, which is what this tab's first table lists and what
    // Add / Rename / Archive change. It counted `budgets.length` — the monthly
    // Budget rows — so adding a category correctly-but-uselessly left it alone,
    // and the admin read that as the add having failed.
    budgets: categories.filter((c) => !c.archived).length,
    suppliers: suppliers.length,
    inventoryLocations: inventoryLocations.length,
    serviceAreas: serviceAreas.length,
    notifications: notificationSettings.length,
  };

  const visibleGroups = TAB_GROUPS.map((g) => ({
    label: g.label,
    ids: g.ids.filter((id) => {
      const tab = TABS.find((t) => t.id === id);
      return tab && (!tab.adminOnly || isAdmin);
    }),
  })).filter((g) => g.ids.length > 0);

  const activeDef = TABS.find((t) => t.id === activeTab);
  const isReadOnly = activeTab === "roles";

  // Sections the server could not load that this tab actually needs. Anything
  // else that failed is somebody else's tab and is not the admin's problem
  // while they're standing here.
  const activeFailures = failedSections.filter((f) => {
    if (f.key === "appSettings") return APP_SETTING_TABS.includes(activeTab);
    return (TAB_DATA_DEPS[activeTab] ?? []).includes(f.key);
  });

  return (
    <div className="admin-font stack-24">
      <header className="stack-8">
        {/* The cleaner settings route re-exports this page, so this label must
            follow the viewer's role — it used to read "Admin" for everyone,
            including every cleaner. */}
        <p className="eyebrow">{isAdmin ? "Admin" : "Account"}</p>
        <h1 className="display">Settings</h1>
        <p style={{ fontSize: 15, color: "var(--primary-70)" }}>
          {isAdmin
            ? "Manage your account and application configuration."
            : "Manage your account."}
        </p>
      </header>

      {/* Permanent install entry point. The floating prompt is dismissible and
          desktop-hidden, and the sidebar entry only lives in the mobile
          drawer, so Settings is where people go looking for "download the
          app". */}
      <InstallAppCard />

      <div className="set-layout">
        <nav className="set-menu">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <div className="set-menu-label">{group.label}</div>
              {group.ids.map((id) => {
                const tab = TABS.find((t) => t.id === id)!;
                const Icon = tab.icon;
                const active = activeTab === id;
                const count = tabCounts[id];
                return (
                  <button
                    key={id}
                    type="button"
                    className={`smenu-item${active ? " active" : ""}`}
                    onClick={() => setActiveTab(id)}>
                    <Icon strokeWidth={1.9} size={16} />
                    <span>{tab.label}</span>
                    {count !== undefined && (
                      <span
                        className="smenu-num"
                        title={`${count} ${count === 1 ? "record" : "records"}`}>
                        {count}
                      </span>
                    )}
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
          {activeFailures.length > 0 && (
            <div
              role="alert"
              style={{
                padding: "12px 16px",
                borderRadius: 12,
                fontSize: 13,
                marginBottom: 16,
                background: "#fee2e2",
                color: "#b91c1c",
              }}>
              <strong>
                {activeFailures.map((f) => f.label).join(", ")} could not be
                loaded.
              </strong>{" "}
              This section is showing empty. Everything else on this page still
              works — reload to try again, and tell support if it keeps
              happening.
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
          {activeTab === "serviceContent" && isAdmin && (
            <ServiceContentTab settings={appSettings} />
          )}
          {activeTab === "bookingPage" && isAdmin && (
            <BookingPageTab settings={appSettings} />
          )}
          {activeTab === "paymentTypes" && isAdmin && (
            <PaymentTypesTab settings={appSettings} />
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
          {activeTab === "budgets" && isAdmin && (
            <BudgetsTab
              transactions={transactions}
              budgets={budgets}
              categories={categories}
              onCategoriesChange={setCategories}
            />
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


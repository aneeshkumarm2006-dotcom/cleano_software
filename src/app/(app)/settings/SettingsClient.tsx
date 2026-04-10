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
import {
  SettingsUser,
  AppSettingRecord,
  ProductRecord,
  KitTemplateRecord,
  InventoryRuleRecord,
  SupplierRecord,
} from "./types";

interface SettingsClientProps {
  user: SettingsUser;
  isAdmin: boolean;
  appSettings: AppSettingRecord[];
  products: ProductRecord[];
  kitTemplates: KitTemplateRecord[];
  inventoryRules: InventoryRuleRecord[];
  suppliers: SupplierRecord[];
}

type TabId =
  | "profile"
  | "tax"
  | "pricing"
  | "jobTypes"
  | "paymentTypes"
  | "inventoryRules"
  | "kitTemplates"
  | "multipliers"
  | "roles"
  | "suppliers";

interface TabDef {
  id: TabId;
  label: string;
  icon: typeof UserIcon;
  adminOnly?: boolean;
}

const TABS: TabDef[] = [
  { id: "profile", label: "Profile", icon: UserIcon },
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
  { id: "multipliers", label: "Multipliers", icon: Star, adminOnly: true },
  { id: "roles", label: "Roles", icon: Shield, adminOnly: true },
  { id: "suppliers", label: "Suppliers", icon: Truck, adminOnly: true },
];

export default function SettingsClient({
  user,
  isAdmin,
  appSettings,
  products,
  kitTemplates,
  inventoryRules,
  suppliers,
}: SettingsClientProps) {
  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);
  const [activeTab, setActiveTab] = useState<TabId>("profile");

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-[600] text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage your account and application configuration
        </p>
      </div>

      <div className="flex gap-6">
        {/* Sidebar tabs */}
        <nav className="w-56 flex-shrink-0">
          <ul className="space-y-1">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <li key={tab.id}>
                  <button
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-[400] transition-all duration-150 ${
                      active
                        ? "bg-[#005F6A] text-white"
                        : "text-[#005F6A] hover:bg-[#005F6A]/10"
                    }`}>
                    <Icon strokeWidth={1.6} className="w-4 h-4" />
                    {tab.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Content panel */}
        <div className="flex-1 min-w-0">
          {activeTab === "profile" && <ProfileTab user={user} />}
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
          {activeTab === "multipliers" && isAdmin && (
            <MultipliersTab settings={appSettings} />
          )}
          {activeTab === "roles" && isAdmin && <RolesTab />}
          {activeTab === "suppliers" && isAdmin && (
            <SuppliersTab products={products} suppliers={suppliers} />
          )}
        </div>
      </div>
    </div>
  );
}

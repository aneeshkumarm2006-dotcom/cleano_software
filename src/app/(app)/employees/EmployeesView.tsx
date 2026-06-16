"use client";

import React from "react";
import {
  Search,
  Plus,
  Users,
  DollarSign,
  Briefcase,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Pencil,
  SlidersHorizontal,
} from "lucide-react";
import PremiumSelect from "@/components/ui/PremiumSelect";
import ImportCsvButton from "@/components/csv/ImportCsvButton";

interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "OWNER" | "ADMIN" | "EMPLOYEE";
  isActive?: boolean;
  completedJobsCount: number;
  activeJobsCount: number;
  totalRevenue: number;
  unpaidJobs: number;
}

interface EmployeeStats {
  totalEmployees: number;
  admins: number;
  activeEmployees: number;
  totalRevenue: number;
}

interface EmployeesViewProps {
  employees: Employee[];
  stats: EmployeeStats;
  isLoading: boolean;
  searchTerm: string;
  roleFilter: string;
  jobStatusFilter: string;
  rowsPerPage: number;
  page: number;
  onSearchTermChange: (term: string) => void;
  onRoleFilterChange: (filter: string) => void;
  onJobStatusFilterChange: (filter: string) => void;
  onRowsPerPageChange: (rowsPerPage: number) => void;
  onPageChange: (page: number) => void;
  updateURLParams: (updates: Record<string, string | number>) => void;
  onCreateEmployee: () => void;
  onEditEmployee: (employee: Employee) => void;
}

const AVATAR_COLORS = ["#005F6A", "#0284c7", "#7c3aed", "#dc2626", "#d97706", "#059669", "#0891b2", "#be185d"];

function avatarColor(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map(p => p[0] ?? "").join("").toUpperCase();
}

function RolePill({ role }: { role: string }) {
  const cfg: Record<string, { bg: string; color: string; label: string }> = {
    OWNER:    { bg: "#e0f2f1", color: "#005F6A", label: "Owner" },
    ADMIN:    { bg: "#e0e7ff", color: "#4338ca", label: "Admin" },
    EMPLOYEE: { bg: "#f1f5f9", color: "#475569", label: "Employee" },
  };
  const c = cfg[role] ?? cfg.EMPLOYEE;
  return (
    <span style={{
      display: "inline-block",
      background: c.bg,
      color: c.color,
      fontSize: 11,
      fontWeight: 600,
      borderRadius: 20,
      padding: "2px 10px",
      letterSpacing: "0.02em",
    }}>
      {c.label}
    </span>
  );
}

function AStatCard({ icon: Icon, label, value, hint, warn }: {
  icon: React.ElementType; label: string; value: string; hint?: string; warn?: boolean;
}) {
  return (
    <div className="astat" style={warn ? { borderLeft: "3px solid #d97706" } : {}}>
      <div className="astat-head" style={warn ? { color: "#92400e" } : {}}>
        <span>{label}</span>
        <span className="astat-icon" style={warn ? { background: "#fffbeb", color: "#d97706" } : {}}>
          <Icon size={15} />
        </span>
      </div>
      <div className="astat-value" style={warn ? { color: "#92400e" } : {}}>{value}</div>
      {hint && <div className="astat-delta">{hint}</div>}
    </div>
  );
}

export default function EmployeesView({
  employees,
  stats,
  isLoading,
  searchTerm,
  roleFilter,
  jobStatusFilter,
  rowsPerPage,
  page,
  onSearchTermChange,
  onRoleFilterChange,
  onJobStatusFilterChange,
  onRowsPerPageChange,
  onPageChange,
  updateURLParams,
  onCreateEmployee,
  onEditEmployee,
}: EmployeesViewProps) {
  const [showFilters, setShowFilters] = React.useState(false);

  const filteredEmployees = employees.filter((e) => {
    const q = searchTerm.toLowerCase();
    if (searchTerm && !e.name.toLowerCase().includes(q) && !e.email.toLowerCase().includes(q) && !(e.phone?.includes(searchTerm))) return false;
    if (roleFilter !== "all" && e.role !== roleFilter) return false;
    if (jobStatusFilter === "active" && e.activeJobsCount === 0) return false;
    if (jobStatusFilter === "completed" && e.completedJobsCount === 0) return false;
    if (jobStatusFilter === "unpaid" && e.unpaidJobs === 0) return false;
    return true;
  });

  const total = filteredEmployees.length;
  const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));
  const startIdx = (page - 1) * rowsPerPage;
  const paginated = filteredEmployees.slice(startIdx, startIdx + rowsPerPage);

  const goToPage = (p: number) => {
    const np = Math.min(Math.max(1, p), totalPages);
    onPageChange(np);
    updateURLParams({ page: np });
  };

  const activeFilterCount = [roleFilter !== "all", jobStatusFilter !== "all"].filter(Boolean).length;

  const clearFilters = () => {
    onRoleFilterChange("all");
    onJobStatusFilterChange("all");
    onPageChange(1);
    updateURLParams({ role: "all", jobStatus: "all", page: 1 });
  };

  return (
    <div className="admin-font stack-24">
      <header className="row-between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div className="stack-8">
          <p className="eyebrow">Staff</p>
          <h1 className="display">
            Employees{" "}
            <span style={{ color: "var(--primary-40)", fontWeight: 300 }}>· {stats.totalEmployees}</span>
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <ImportCsvButton entity="employees" />
          <button type="button" className="btn btn-primary" onClick={onCreateEmployee}>
            <Plus size={16} /> Add Employee
          </button>
        </div>
      </header>

      <div className="astat-grid">
        <AStatCard icon={Users}      label="Total employees"  value={String(stats.totalEmployees)} hint="all time" />
        <AStatCard icon={Users}      label="Admins"           value={String(stats.admins)} hint="admin or owner" />
        <AStatCard icon={Briefcase}  label="Active now"       value={String(stats.activeEmployees)} hint="with active jobs" />
        <AStatCard icon={DollarSign} label="Total revenue"    value={`$${stats.totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`} />
      </div>

      <div className="atoolbar">
        <div className="atoolbar-search">
          <span className="atoolbar-search-icon"><Search size={14} /></span>
          <input
            className="input"
            value={searchTerm}
            onChange={e => { onSearchTermChange(e.target.value); onPageChange(1); updateURLParams({ search: e.target.value, page: 1 }); }}
            placeholder="Search by name, email, or phone…"
          />
        </div>
        <button
          type="button"
          className={`afilter-toggle${showFilters ? " open" : ""}`}
          onClick={() => setShowFilters(v => !v)}>
          <SlidersHorizontal size={14} />
          Filters
          {activeFilterCount > 0 && <span className="afilter-badge">{activeFilterCount}</span>}
        </button>
        <PremiumSelect
          value={String(rowsPerPage)}
          onChange={v => { onRowsPerPageChange(Number(v)); onPageChange(1); updateURLParams({ rowsPerPage: Number(v), page: 1 }); }}
          options={[5, 10, 25, 50].map(n => ({ value: String(n), label: `${n} / page` }))}
          size="sm"
          style={{ width: 110 }}
        />
        <span style={{ fontSize: 13, color: "var(--primary-60)" }}>
          {total} employee{total !== 1 ? "s" : ""}
        </span>
      </div>

      {showFilters && (
        <div className="afilter-panel">
          <div className="field">
            <label className="label">Role</label>
            <PremiumSelect
              value={roleFilter}
              onChange={v => { onRoleFilterChange(v); onPageChange(1); updateURLParams({ role: v, page: 1 }); }}
              options={[
                { value: "all", label: "All roles" },
                { value: "OWNER", label: "Owner" },
                { value: "ADMIN", label: "Admin" },
                { value: "EMPLOYEE", label: "Employee" },
              ]}
              size="sm"
            />
          </div>
          <div className="field">
            <label className="label">Job status</label>
            <PremiumSelect
              value={jobStatusFilter}
              onChange={v => { onJobStatusFilterChange(v); onPageChange(1); updateURLParams({ jobStatus: v, page: 1 }); }}
              options={[
                { value: "all", label: "All" },
                { value: "active", label: "Active jobs" },
                { value: "completed", label: "Has completed" },
                { value: "unpaid", label: "Has unpaid" },
              ]}
              size="sm"
            />
          </div>
          <div className="afilter-panel-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear all</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowFilters(false)}>Done</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="atable-wrap" style={{ padding: "80px 40px", textAlign: "center", color: "var(--primary-60)" }}>
          Loading employees…
        </div>
      ) : total === 0 ? (
        <div className="atable-wrap" style={{ padding: "80px 40px", textAlign: "center", color: "var(--primary-60)" }}>
          No employees match these filters.
        </div>
      ) : (
        <div className="atable-wrap">
          <div id="emp-desktop">
            <div className="atable-scroll">
              <table className="atable">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Contact</th>
                    <th>Role</th>
                    <th className="num">Completed</th>
                    <th className="num">Active</th>
                    <th className="num">Revenue</th>
                    <th className="col-actions" />
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(e => (
                    <tr key={e.id} onClick={() => { window.location.href = `/employees/${e.id}`; }}>
                      <td style={{ minWidth: 200 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span className="avatar" style={{ background: avatarColor(e.name), fontSize: 12, width: 36, height: 36 }}>
                            {initials(e.name)}
                          </span>
                          <div>
                            <div className="col-client">{e.name}</div>
                            {e.email && <div className="col-client-sub">{e.email}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{ minWidth: 160 }}>
                        {e.phone ? (
                          <div className="col-client-sub">{e.phone}</div>
                        ) : (
                          <span style={{ color: "var(--primary-40)" }}>—</span>
                        )}
                      </td>
                      <td><RolePill role={e.role} /></td>
                      <td className="num">
                        <span style={{ fontWeight: 600, color: "var(--ink)" }}>{e.completedJobsCount}</span>
                      </td>
                      <td className="num">
                        {e.activeJobsCount > 0 ? (
                          <span style={{ fontWeight: 600, color: "#059669" }}>{e.activeJobsCount}</span>
                        ) : <span style={{ color: "var(--primary-40)" }}>—</span>}
                      </td>
                      <td className="num" style={{ fontWeight: 600, color: "var(--ink)" }}>
                        ${e.totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </td>
                      <td className="col-actions" onClick={ev => ev.stopPropagation()}>
                        <div className="row">
                          <button type="button" className="icon-btn" title="Edit" onClick={() => onEditEmployee(e)}>
                            <Pencil size={14} />
                          </button>
                          <a href={`/employees/${e.id}`} className="btn btn-secondary btn-sm">View</a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div id="emp-mobile" style={{ display: "none", flexDirection: "column", gap: 10, padding: 16 }}>
            {paginated.map(e => (
              <article key={e.id} className="jcard" style={{ cursor: "pointer" }} onClick={() => { window.location.href = `/employees/${e.id}`; }}>
                <div className="jcard-top">
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span className="avatar" style={{ background: avatarColor(e.name), fontSize: 12, width: 36, height: 36 }}>
                      {initials(e.name)}
                    </span>
                    <div>
                      <div className="jcard-client">{e.name}</div>
                      <div className="jcard-meta">{e.email}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="jcard-price">${e.totalRevenue.toFixed(0)}</div>
                    <RolePill role={e.role} />
                  </div>
                </div>
                <div className="jcard-row" style={{ paddingTop: 10, borderTop: "1px solid var(--primary-10)", marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: "var(--primary-70)" }}>
                    {e.completedJobsCount} done · {e.activeJobsCount} active
                  </div>
                  {e.unpaidJobs > 0 && (
                    <div style={{ fontSize: 12, color: "#d97706", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                      <AlertTriangle size={12} />
                      {e.unpaidJobs} unpaid
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>

          <div className="apager">
            <span>Showing {startIdx + 1}–{Math.min(startIdx + rowsPerPage, total)} of {total}</span>
            <div className="apager-controls">
              <button type="button" className="apager-btn" disabled={page === 1} onClick={() => goToPage(1)}>«</button>
              <button type="button" className="apager-btn" disabled={page === 1} onClick={() => goToPage(page - 1)}>
                <ChevronLeft size={14} />
              </button>
              <span className="apager-btn active">{page}</span>
              <span style={{ fontSize: 12, color: "var(--primary-50)", alignSelf: "center" }}>/ {totalPages}</span>
              <button type="button" className="apager-btn" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
                <ChevronRight size={14} />
              </button>
              <button type="button" className="apager-btn" disabled={page >= totalPages} onClick={() => goToPage(totalPages)}>»</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 900px) {
          #emp-desktop { display: none !important; }
          #emp-mobile  { display: flex !important; }
        }
      `}</style>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Search,
  Plus,
  Users,
  DollarSign,
  AlertTriangle,
  Briefcase,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Pencil,
  Trash2,
  Mail,
  Phone,
  MapPin,
  Loader,
  ChevronDown,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import CustomDropdown from "@/components/ui/custom-dropdown";
import ClientModal from "./ClientModal";
import { deleteClient } from "../actions/deleteClient";

interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  totalJobs: number;
  completedJobs: number;
  totalRevenue: number;
  unpaidJobs: number;
  lastJobDate: string | null;
}

interface ClientsPageClientProps {
  initialClients: Client[];
  initialStats: {
    totalClients: number;
    totalRevenue: number;
    activeClients: number;
    unpaidJobs: number;
  };
  initialSearch: string;
  initialPage: number;
  initialRowsPerPage: number;
}

export default function ClientsPageClient({
  initialClients,
  initialStats,
  initialSearch,
  initialPage,
  initialRowsPerPage,
}: ClientsPageClientProps) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [page, setPage] = useState(initialPage);
  const [rowsPerPage, setRowsPerPage] = useState(initialRowsPerPage);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const filtered = initialClients.filter((c) => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (c.email?.toLowerCase().includes(q) ?? false) ||
      (c.phone?.toLowerCase().includes(q) ?? false) ||
      (c.address?.toLowerCase().includes(q) ?? false)
    );
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));
  const startIdx = (page - 1) * rowsPerPage;
  const paginated = filtered.slice(startIdx, startIdx + rowsPerPage);

  const goToPage = (p: number) => setPage(Math.min(Math.max(1, p), totalPages));

  const handleCreate = () => {
    setSelectedClient(null);
    setModalMode("create");
    setIsModalOpen(true);
  };

  const handleEdit = (c: Client) => {
    setSelectedClient(c);
    setModalMode("edit");
    setIsModalOpen(true);
  };

  const handleDelete = async (c: Client) => {
    if (c.totalJobs > 0) {
      setErrorMsg(
        `Cannot delete "${c.name}" — ${c.totalJobs} job${
          c.totalJobs === 1 ? "" : "s"
        } linked.`
      );
      return;
    }
    if (!confirm(`Delete "${c.name}"?`)) return;
    setDeletingId(c.id);
    const result = await deleteClient(c.id);
    setDeletingId(null);
    if (result.error) {
      setErrorMsg(result.error);
    } else {
      router.refresh();
    }
  };

  const MetricCard = ({
    label,
    value,
    variant = "default",
  }: {
    label: string;
    value: string;
    variant?: "default" | "warning";
  }) => (
    <Card
      variant={variant === "warning" ? "warning" : "cleano_light"}
      className="p-6 h-[7rem]">
      <div className="h-full flex flex-col justify-between">
        <span
          className={`app-title-small ${
            variant === "warning" ? "text-yellow-700" : "!text-[#005F6A]/70"
          }`}>
          {label}
        </span>
        <p
          className={`h2-title ${
            variant === "warning" ? "text-yellow-700" : "text-[#005F6A]"
          }`}>
          {value}
        </p>
      </div>
    </Card>
  );

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl !font-light tracking-tight text-[#005F6A]">
            Clients
          </h1>
          <p className="text-sm text-[#005F6A]/70 !font-light mt-1">
            Manage your clients and view their job history
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          border={false}
          onClick={handleCreate}
          className="rounded-2xl px-6 py-3">
          <Plus className="w-4 h-4 mr-2" />
          New Client
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          label="Total Clients"
          value={String(initialStats.totalClients)}
        />
        <MetricCard
          label="Active Clients"
          value={String(initialStats.activeClients)}
        />
        <MetricCard
          label="Total Revenue"
          value={`$${initialStats.totalRevenue.toFixed(2)}`}
        />
        {initialStats.unpaidJobs > 0 ? (
          <MetricCard
            label="Unpaid Jobs"
            value={String(initialStats.unpaidJobs)}
            variant="warning"
          />
        ) : (
          <MetricCard label="Unpaid Jobs" value="0" />
        )}
      </div>

      {/* Error */}
      {errorMsg && (
        <div className="mb-4 rounded-2xl bg-red-50 border border-red-200 p-3 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5" />
          <div className="flex-1 text-sm text-red-700">{errorMsg}</div>
          <button
            className="text-xs text-red-600 underline"
            onClick={() => setErrorMsg(null)}>
            dismiss
          </button>
        </div>
      )}

      {/* Search */}
      <div className="flex flex-col lg:flex-row gap-2 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#005F6A]/60 z-[100] w-4 h-4" />
          <Input
            placeholder="Search clients by name, email, phone, or address..."
            value={searchTerm}
            size="md"
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
            className="pl-10 h-[42px] py-3 placeholder:!text-[#005F6A]/40 placeholder:!font-[350]"
            variant="form"
            border={false}
          />
        </div>
        <CustomDropdown
          trigger={
            <Button
              variant="default"
              size="md"
              border={false}
              className="min-w-20 h-[42px] px-4 py-3 flex items-center justify-between w-fit">
              <span className="text-sm font-[350]">{rowsPerPage} / page</span>
              <ChevronDown className="w-4 h-4 ml-2 flex-shrink-0" />
            </Button>
          }
          options={[5, 10, 25, 50, 100].map((n) => ({
            label: String(n),
            onClick: () => {
              setRowsPerPage(n);
              setPage(1);
            },
          }))}
          maxHeight="12rem"
        />
      </div>

      {/* Table */}
      {total === 0 ? (
        <div className="bg-white rounded-2xl">
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-[#005F6A]/5 rounded-full flex items-center justify-center mx-auto mb-3">
              <Users className="w-8 h-8 text-[#005F6A]/40" />
            </div>
            <p className="text-sm font-[350] text-[#005F6A]/70">
              No clients found
            </p>
            <p className="text-xs font-[350] text-[#005F6A]/60 mt-1">
              Create your first client to get started
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl">
          <div className="hidden lg:block overflow-x-auto rounded-t-2xl">
            <div className="min-w-max">
              <div className="flex bg-[#005F6A]/5 rounded-t-2xl">
                {[
                  { label: "Name", className: "w-[220px] text-left" },
                  { label: "Contact", className: "w-[240px] text-left" },
                  { label: "Jobs", className: "w-[100px] text-center" },
                  { label: "Revenue", className: "w-[140px] text-right" },
                  { label: "Unpaid", className: "w-[100px] text-center" },
                  { label: "Last Job", className: "w-[140px] text-left" },
                  { label: "Actions", className: "w-[220px] text-left" },
                ].map((col) => (
                  <div
                    key={col.label}
                    className={`p-4 text-xs font-[350] !text-[#005F6A]/40 uppercase !tracking-wider ${col.className}`}>
                    {col.label}
                  </div>
                ))}
              </div>

              <div className="divide-y divide-[#005F6A]/4">
                {paginated.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center hover:bg-[#005F6A]/1 transition-colors">
                    <div className="w-[220px] p-4">
                      <Link
                        href={`/clients/${c.id}`}
                        className="app-title-small truncate text-[#005F6A] hover:underline">
                        {c.name}
                      </Link>
                      {c.address && (
                        <p className="app-subtitle !text-[#005F6A]/50 truncate text-xs mt-0.5">
                          {c.address}
                        </p>
                      )}
                    </div>

                    <div className="w-[240px] p-4 space-y-0.5">
                      {c.email && (
                        <p className="app-subtitle !text-[#005F6A]/70 truncate text-xs flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {c.email}
                        </p>
                      )}
                      {c.phone && (
                        <p className="app-subtitle !text-[#005F6A]/70 truncate text-xs flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {c.phone}
                        </p>
                      )}
                      {!c.email && !c.phone && (
                        <p className="app-subtitle !text-[#005F6A]/40 text-xs">
                          —
                        </p>
                      )}
                    </div>

                    <div className="w-[100px] p-4 text-center">
                      <span className="app-title-small !text-[#005F6A]">
                        {c.totalJobs}
                      </span>
                      {c.completedJobs > 0 && (
                        <p className="text-[10px] text-[#005F6A]/50">
                          {c.completedJobs} done
                        </p>
                      )}
                    </div>

                    <div className="w-[140px] p-4 text-right">
                      <span className="app-title-small !text-[#005F6A]">
                        ${c.totalRevenue.toFixed(2)}
                      </span>
                    </div>

                    <div className="w-[100px] p-4 text-center">
                      {c.unpaidJobs > 0 ? (
                        <span className="text-sm font-[400] text-yellow-600">
                          {c.unpaidJobs}
                        </span>
                      ) : (
                        <span className="text-sm text-[#005F6A]/40">—</span>
                      )}
                    </div>

                    <div className="w-[140px] p-4">
                      <span className="app-title-small !text-[#005F6A]/60 text-xs">
                        {c.lastJobDate
                          ? new Date(c.lastJobDate).toLocaleDateString()
                          : "—"}
                      </span>
                    </div>

                    <div className="w-[220px] p-4 flex items-center gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        border={false}
                        onClick={() => handleEdit(c)}
                        className="rounded-2xl px-3 py-2">
                        <Pencil className="w-3 h-3 mr-1" />
                        Edit
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        border={false}
                        href={`/clients/${c.id}`}
                        className="rounded-2xl px-3 py-2">
                        View
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        border={false}
                        disabled={deletingId === c.id}
                        onClick={() => handleDelete(c)}
                        className="rounded-2xl px-2 py-2">
                        {deletingId === c.id ? (
                          <Loader className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Mobile */}
          <div className="lg:hidden space-y-3 p-4">
            {paginated.map((c) => (
              <Card key={c.id} variant="cleano_light" className="p-4">
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <Link
                      href={`/clients/${c.id}`}
                      className="text-sm font-[400] text-[#005F6A] hover:underline">
                      {c.name}
                    </Link>
                    <span className="text-sm font-[400] text-[#005F6A]">
                      ${c.totalRevenue.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-[#005F6A]/60">
                    <span>
                      {c.totalJobs} job{c.totalJobs === 1 ? "" : "s"}
                    </span>
                    {c.unpaidJobs > 0 && (
                      <span className="text-yellow-600">
                        {c.unpaidJobs} unpaid
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="default"
                      size="sm"
                      border={false}
                      onClick={() => handleEdit(c)}
                      className="rounded-2xl px-4 py-2 flex-1">
                      Edit
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      border={false}
                      href={`/clients/${c.id}`}
                      className="rounded-2xl px-4 py-2 flex-1">
                      View
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between p-2 px-3 bg-[#005F6A]/4 rounded-b-2xl">
            <div className="text-xs text-[#005F6A]/70 font-[350]">
              Showing {startIdx + 1} to {Math.min(startIdx + rowsPerPage, total)} of{" "}
              {total} clients
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => goToPage(1)}
                disabled={page === 1}
                className="px-2">
                <ChevronsLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => goToPage(page - 1)}
                disabled={page === 1}
                className="px-2">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-xs text-[#005F6A]/70 px-2">
                Page {page} / {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages}
                className="px-2">
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => goToPage(totalPages)}
                disabled={page >= totalPages}
                className="px-2">
                <ChevronsRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      <ClientModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        mode={modalMode}
        client={selectedClient}
      />
    </div>
  );
}

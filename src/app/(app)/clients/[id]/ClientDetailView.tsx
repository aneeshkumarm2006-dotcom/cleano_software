"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  FileText,
  Briefcase,
  DollarSign,
  CreditCard,
  Star,
  Calendar,
  Pencil,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import ClientModal from "../ClientModal";

type TabKey = "history" | "payments" | "ratings";

interface ClientData {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
}

interface JobLite {
  id: string;
  clientName: string;
  location: string | null;
  jobType: string | null;
  jobDate: string | null;
  startTime: string;
  endTime: string | null;
  status: string;
  price: number | null;
  employeePay: number | null;
  totalTip: number | null;
  parking: number | null;
  paymentReceived: boolean;
  invoiceSent: boolean;
  notes: string | null;
  paymentType: string | null;
  discountAmount: number | null;
  cleaners: Array<{ id: string; name: string }>;
}

interface Totals {
  totalRevenue: number;
  totalPaid: number;
  unpaidAmount: number;
  jobCount: number;
}

export default function ClientDetailView({
  client,
  jobs,
  totals,
}: {
  client: ClientData;
  jobs: JobLite[];
  totals: Totals;
}) {
  const [tab, setTab] = useState<TabKey>("history");
  const [editOpen, setEditOpen] = useState(false);

  const getStatusBadge = (status: string) => {
    const map: Record<string, { variant: any; label: string }> = {
      CREATED: { variant: "default", label: "Created" },
      SCHEDULED: { variant: "warning", label: "Scheduled" },
      IN_PROGRESS: { variant: "secondary", label: "In Progress" },
      COMPLETED: { variant: "success", label: "Completed" },
      PAID: { variant: "cleano", label: "Paid" },
      CANCELLED: { variant: "error", label: "Cancelled" },
    };
    const c = map[status] || { variant: "default", label: status };
    return (
      <Badge variant={c.variant} size="sm">
        {c.label}
      </Badge>
    );
  };

  const MetricCard = ({ label, value }: { label: string; value: string }) => (
    <Card variant="cleano_light" className="p-6 h-[7rem]">
      <div className="h-full flex flex-col justify-between">
        <span className="app-title-small !text-[#005F6A]/70">{label}</span>
        <p className="h2-title text-[#005F6A]">{value}</p>
      </div>
    </Card>
  );

  return (
    <div className="max-w-[80rem] mx-auto space-y-6">
      <Link href="/clients">
        <Button
          variant="default"
          size="sm"
          border={false}
          className="mb-2 px-6 py-3">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Clients
        </Button>
      </Link>

      {/* Header */}
      <div className="flex flex-col md:flex-row items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-3xl !font-light tracking-tight text-[#005F6A]">
            {client.name}
          </h1>
          <div className="flex flex-wrap gap-4 text-sm text-[#005F6A]/70 mt-2">
            {client.email && (
              <span className="flex items-center gap-1">
                <Mail className="w-4 h-4" />
                {client.email}
              </span>
            )}
            {client.phone && (
              <span className="flex items-center gap-1">
                <Phone className="w-4 h-4" />
                {client.phone}
              </span>
            )}
            {client.address && (
              <span className="flex items-center gap-1">
                <MapPin className="w-4 h-4" />
                {client.address}
              </span>
            )}
          </div>
        </div>
        <Button
          variant="primary"
          size="md"
          border={false}
          onClick={() => setEditOpen(true)}
          className="px-6 py-3">
          <Pencil className="w-4 h-4 mr-2" />
          Edit Client
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Total Jobs" value={String(totals.jobCount)} />
        <MetricCard
          label="Total Revenue"
          value={`$${totals.totalRevenue.toFixed(2)}`}
        />
        <MetricCard
          label="Collected"
          value={`$${totals.totalPaid.toFixed(2)}`}
        />
        <MetricCard
          label="Unpaid"
          value={`$${totals.unpaidAmount.toFixed(2)}`}
        />
      </div>

      {/* Notes */}
      {client.notes && (
        <Card variant="cleano_light" className="p-6">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4 text-[#005F6A]" />
            <h3 className="text-sm font-[400] text-[#005F6A]">Notes</h3>
          </div>
          <p className="text-sm text-[#005F6A]/80 whitespace-pre-wrap">
            {client.notes}
          </p>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 bg-[#005F6A]/5 rounded-2xl p-1 w-fit overflow-x-auto">
        {[
          {
            id: "history" as TabKey,
            label: "Job History",
            icon: <Briefcase className="w-4 h-4" />,
          },
          {
            id: "payments" as TabKey,
            label: "Payments",
            icon: <CreditCard className="w-4 h-4" />,
          },
          {
            id: "ratings" as TabKey,
            label: "Ratings",
            icon: <Star className="w-4 h-4" />,
          },
        ].map((t) => (
          <Button
            key={t.id}
            border={false}
            onClick={() => setTab(t.id)}
            variant={tab === t.id ? "action" : "ghost"}
            size="md"
            className="rounded-xl px-4 md:px-6 py-3 whitespace-nowrap">
            <span className="mr-2 hidden sm:inline">{t.icon}</span>
            {t.label}
          </Button>
        ))}
      </div>

      {/* History */}
      {tab === "history" && (
        <Card variant="default" className="p-6">
          {jobs.length === 0 ? (
            <div className="text-center py-12">
              <Briefcase className="w-8 h-8 text-[#005F6A]/40 mx-auto mb-3" />
              <p className="text-sm text-[#005F6A]/60">No jobs yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {jobs.map((j) => (
                <Link
                  key={j.id}
                  href={`/jobs/${j.id}`}
                  className="flex items-center justify-between p-4 rounded-xl bg-[#005F6A]/5 hover:bg-[#005F6A]/10 transition-colors">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-[400] text-[#005F6A]">
                        {j.jobDate
                          ? new Date(j.jobDate).toLocaleDateString()
                          : new Date(j.startTime).toLocaleDateString()}
                      </span>
                      {getStatusBadge(j.status)}
                      {j.jobType && (
                        <Badge variant="cleano" size="sm">
                          {j.jobType}
                        </Badge>
                      )}
                    </div>
                    {j.location && (
                      <p className="text-xs text-[#005F6A]/60 mt-1">
                        {j.location}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-[400] text-[#005F6A]">
                      {j.price ? `$${j.price.toFixed(2)}` : "—"}
                    </p>
                    {j.discountAmount && j.discountAmount > 0 && (
                      <p className="text-xs text-yellow-600">
                        −${j.discountAmount.toFixed(2)}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Payments */}
      {tab === "payments" && (
        <Card variant="default" className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="w-4 h-4 text-[#005F6A]" />
            <h3 className="text-sm font-[400] text-[#005F6A]">
              Payment History
            </h3>
          </div>
          {jobs.filter((j) => j.paymentReceived).length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-[#005F6A]/60">
                No payments recorded yet
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {jobs
                .filter((j) => j.paymentReceived)
                .map((j) => (
                  <div
                    key={j.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-green-50">
                    <div className="flex-1">
                      <p className="text-sm text-[#005F6A]">
                        {j.jobDate
                          ? new Date(j.jobDate).toLocaleDateString()
                          : new Date(j.startTime).toLocaleDateString()}
                      </p>
                      {j.paymentType && (
                        <p className="text-xs text-[#005F6A]/60">
                          {j.paymentType}
                        </p>
                      )}
                    </div>
                    <span className="text-sm font-[400] text-green-700">
                      +${(j.price || 0).toFixed(2)}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </Card>
      )}

      {/* Ratings */}
      {tab === "ratings" && (
        <Card variant="default" className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Star className="w-4 h-4 text-[#005F6A]" />
            <h3 className="text-sm font-[400] text-[#005F6A]">
              Ratings & Reviews
            </h3>
          </div>
          <div className="text-center py-8">
            <Star className="w-8 h-8 text-[#005F6A]/40 mx-auto mb-3" />
            <p className="text-sm text-[#005F6A]/60">
              Rating system coming soon
            </p>
          </div>
        </Card>
      )}

      <ClientModal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        mode="edit"
        client={client}
      />
    </div>
  );
}

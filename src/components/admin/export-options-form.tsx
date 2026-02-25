"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatTimeInZone } from "@/lib/utils";
import { CalendarDays, Download, Printer, Loader2 } from "lucide-react";

type Bay = { id: string; name: string };

interface ExportOptionsFormProps {
  orgId: string;
  orgSlug: string;
  orgTimezone: string;
  bays: Bay[];
  defaultDate: string;
}

export function ExportOptionsForm({
  orgId,
  orgSlug,
  orgTimezone,
  bays,
  defaultDate,
}: ExportOptionsFormProps) {
  const [dateMode, setDateMode] = useState<"single" | "range">("single");
  const [fromDate, setFromDate] = useState(defaultDate);
  const [toDate, setToDate] = useState(defaultDate);
  const [format, setFormat] = useState<"pdf" | "timeline" | "csv">("pdf");
  const [bayFilter, setBayFilter] = useState("");
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  const effectiveToDate = dateMode === "single" ? fromDate : toDate;

  function handleExportPrint(layout?: string) {
    const params = new URLSearchParams();
    params.set("from", fromDate);
    params.set("to", effectiveToDate);
    if (bayFilter) params.set("bay", bayFilter);
    if (layout) params.set("layout", layout);
    window.open(`/admin/bookings/export/print?${params.toString()}`, "_blank");
  }

  async function handleExportCsv() {
    setExporting(true);
    setError("");

    try {
      const supabase = createClient();

      // Fetch bookings
      let query = supabase
        .from("bookings")
        .select(
          "id, date, start_time, end_time, total_price_cents, status, confirmation_code, notes, created_at, customer_id, bay_id, is_guest, guest_name, guest_email, guest_phone"
        )
        .eq("org_id", orgId)
        .gte("date", fromDate)
        .lte("date", effectiveToDate)
        .order("date", { ascending: true })
        .order("start_time", { ascending: true });

      if (!includeCancelled) {
        query = query.eq("status", "confirmed");
      }
      if (bayFilter) {
        query = query.eq("bay_id", bayFilter);
      }

      const { data: bookings, error: fetchError } = await query;
      if (fetchError) throw new Error(fetchError.message);
      if (!bookings || bookings.length === 0) {
        setError("No bookings found for the selected criteria.");
        setExporting(false);
        return;
      }

      // Look up customer profiles
      const customerIds = [
        ...new Set(bookings.map((b) => b.customer_id).filter(Boolean)),
      ];
      const customerMap: Record<
        string,
        { full_name: string | null; email: string; phone: string | null }
      > = {};
      if (customerIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, email, phone")
          .in("id", customerIds);
        if (profiles) {
          for (const p of profiles) {
            customerMap[p.id] = {
              full_name: p.full_name,
              email: p.email,
              phone: p.phone,
            };
          }
        }
      }

      // Build bay lookup
      const bayMap: Record<string, string> = {};
      for (const b of bays) {
        bayMap[b.id] = b.name;
      }

      // Build CSV
      const headers = [
        "Confirmation Code",
        "Status",
        "Customer Name",
        "Email",
        "Phone",
        "Guest",
        "Bay",
        "Date",
        "Start Time",
        "End Time",
        "Duration (min)",
        "Price",
        "Notes",
        "Created At",
      ];

      const rows = bookings.map((b) => {
        let name: string;
        let email: string;
        let phone: string;
        let isGuest: string;

        if (b.is_guest) {
          name = b.guest_name || "Guest";
          email = b.guest_email || "";
          phone = b.guest_phone || "";
          isGuest = "Yes";
        } else {
          const c = b.customer_id ? customerMap[b.customer_id] : null;
          name = c?.full_name || c?.email || "Unknown";
          email = c?.email || "";
          phone = c?.phone || "";
          isGuest = "No";
        }

        const startTime = formatTimeInZone(b.start_time, orgTimezone);
        const endTime = formatTimeInZone(b.end_time, orgTimezone);
        const durationMs =
          new Date(b.end_time).getTime() - new Date(b.start_time).getTime();
        const durationMin = Math.round(durationMs / 60000);
        const price = `$${(b.total_price_cents / 100).toFixed(2)}`;
        const dateFormatted = new Date(b.date + "T12:00:00").toLocaleDateString(
          "en-US",
          { year: "numeric", month: "2-digit", day: "2-digit" }
        );
        const createdAt = new Date(b.created_at).toLocaleString("en-US", {
          timeZone: orgTimezone,
        });

        return [
          b.confirmation_code,
          b.status,
          name,
          email,
          phone,
          isGuest,
          bayMap[b.bay_id] ?? "Unknown",
          dateFormatted,
          startTime,
          endTime,
          String(durationMin),
          price,
          b.notes || "",
          createdAt,
        ];
      });

      const csvContent = [
        headers.join(","),
        ...rows.map((row) =>
          row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
        ),
      ].join("\n");

      // Download
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const dateLabel =
        fromDate === effectiveToDate
          ? fromDate
          : `${fromDate}_to_${effectiveToDate}`;
      link.href = url;
      link.download = `bookings-${orgSlug}-${dateLabel}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Date Mode */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Date Selection
        </label>
        <div className="inline-flex rounded-lg bg-gray-100 p-0.5 dark:bg-gray-900">
          <button
            type="button"
            onClick={() => setDateMode("single")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              dateMode === "single"
                ? "bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            Single Date
          </button>
          <button
            type="button"
            onClick={() => setDateMode("range")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              dateMode === "range"
                ? "bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            Date Range
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {dateMode === "single" ? "Date" : "From"}
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-10 w-44 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            />
          </div>
          {dateMode === "range" && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                To
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                min={fromDate}
                className="h-10 w-44 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              />
            </div>
          )}
        </div>
      </div>

      {/* Format */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Export Format
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => setFormat("pdf")}
            className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
              format === "pdf"
                ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500 dark:border-blue-500 dark:bg-blue-950/30"
                : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600"
            }`}
          >
            <Printer
              className={`mt-0.5 h-5 w-5 shrink-0 ${
                format === "pdf"
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-gray-400"
              }`}
            />
            <div>
              <p
                className={`text-sm font-medium ${
                  format === "pdf"
                    ? "text-blue-900 dark:text-blue-300"
                    : "text-gray-800 dark:text-white/90"
                }`}
              >
                PDF Table
              </p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Print-optimized table of confirmed bookings. One page per date.
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setFormat("timeline")}
            className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
              format === "timeline"
                ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500 dark:border-blue-500 dark:bg-blue-950/30"
                : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600"
            }`}
          >
            <CalendarDays
              className={`mt-0.5 h-5 w-5 shrink-0 ${
                format === "timeline"
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-gray-400"
              }`}
            />
            <div>
              <p
                className={`text-sm font-medium ${
                  format === "timeline"
                    ? "text-blue-900 dark:text-blue-300"
                    : "text-gray-800 dark:text-white/90"
                }`}
              >
                Daily Timeline
              </p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Visual grid with bay columns and hourly rows, like the daily
                view.
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setFormat("csv")}
            className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
              format === "csv"
                ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500 dark:border-blue-500 dark:bg-blue-950/30"
                : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600"
            }`}
          >
            <Download
              className={`mt-0.5 h-5 w-5 shrink-0 ${
                format === "csv"
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-gray-400"
              }`}
            />
            <div>
              <p
                className={`text-sm font-medium ${
                  format === "csv"
                    ? "text-blue-900 dark:text-blue-300"
                    : "text-gray-800 dark:text-white/90"
                }`}
              >
                CSV Spreadsheet
              </p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Downloadable spreadsheet with all booking details.
              </p>
            </div>
          </button>
        </div>
      </div>

      {/* Bay Filter */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Bay / Facility
        </label>
        <select
          value={bayFilter}
          onChange={(e) => setBayFilter(e.target.value)}
          className="h-10 w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 pr-8 text-sm text-gray-800 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
        >
          <option value="">All bays</option>
          {bays.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {/* CSV-only: Include Cancelled */}
      {format === "csv" && (
        <div className="flex items-center gap-2.5">
          <input
            type="checkbox"
            id="include-cancelled"
            checked={includeCancelled}
            onChange={(e) => setIncludeCancelled(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900"
          />
          <label
            htmlFor="include-cancelled"
            className="text-sm text-gray-700 dark:text-gray-300"
          >
            Include cancelled bookings
          </label>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Export Button */}
      <div className="border-t border-gray-200 pt-5 dark:border-gray-700">
        {format === "csv" ? (
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={exporting}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {exporting ? "Exporting..." : "Download CSV"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() =>
              handleExportPrint(format === "timeline" ? "timeline" : undefined)
            }
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            <Printer className="h-4 w-4" />
            Open Print Preview
          </button>
        )}
      </div>
    </div>
  );
}

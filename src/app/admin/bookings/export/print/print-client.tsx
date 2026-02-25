"use client";

import { Printer, ArrowLeft } from "lucide-react";

export function PrintPageClient() {
  return (
    <div className="print-controls-bar -mx-4 -mt-4 mb-0 flex items-center gap-3 bg-gray-900 px-5 py-3 md:-mx-6 md:-mt-6">
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
      >
        <Printer className="h-4 w-4" />
        Print / Save as PDF
      </button>
      <a
        href="/admin/bookings/export"
        className="inline-flex items-center gap-1.5 rounded-md bg-gray-700 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back
      </a>
    </div>
  );
}

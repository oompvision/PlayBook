"use client";

import type { ReactNode } from "react";

type StickyFooterProps = {
  isDirty: boolean;
  saving?: boolean;
  onSave?: () => void;
  submitLabel?: string;
  /** If true, renders a submit button (for wrapping inside a <form>) */
  isSubmit?: boolean;
  children?: ReactNode;
};

export function StickyFooter({
  isDirty,
  saving = false,
  onSave,
  submitLabel = "Save Changes",
  isSubmit = false,
  children,
}: StickyFooterProps) {
  if (!isDirty && !children) return null;

  return (
    <div
      className="sticky bottom-0 z-10 flex items-center justify-between border-t bg-white px-6 py-4 dark:border-white/[0.05] dark:bg-gray-950"
      style={{ borderTopColor: "#E6E8EB" }}
    >
      <div className="text-sm text-gray-500 dark:text-gray-400">
        {isDirty && "You have unsaved changes"}
      </div>
      <div className="flex items-center gap-3">
        {children}
        {isSubmit ? (
          <button
            type="submit"
            disabled={saving || !isDirty}
            className="inline-flex items-center rounded-lg bg-[#2563EB] px-[18px] py-[10px] text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : submitLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !isDirty}
            className="inline-flex items-center rounded-lg bg-[#2563EB] px-[18px] py-[10px] text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : submitLabel}
          </button>
        )}
      </div>
    </div>
  );
}

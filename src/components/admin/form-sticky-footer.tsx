"use client";

import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Toast } from "@/components/ui/toast";

type FormStickyFooterProps = {
  action: (formData: FormData) => void;
  children: ReactNode;
  className?: string;
  submitLabel?: string;
  toastMessage?: string;
  /** Query param that indicates save success (default: "saved") */
  savedParam?: string;
};

/**
 * Client component that wraps a server-action form and adds:
 * - Dirty state tracking (listens for input/change events)
 * - Sticky footer with "You have unsaved changes" + Save button
 * - Success toast when ?saved=true is in the URL
 */
export function FormStickyFooter({
  action,
  children,
  className = "",
  submitLabel = "Save Changes",
  toastMessage = "Settings saved.",
  savedParam = "saved",
}: FormStickyFooterProps) {
  const [isDirty, setIsDirty] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const searchParams = useSearchParams();
  const router = useRouter();

  // Track form changes
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;

    const handler = () => setIsDirty(true);
    form.addEventListener("input", handler);
    form.addEventListener("change", handler);

    return () => {
      form.removeEventListener("input", handler);
      form.removeEventListener("change", handler);
    };
  }, []);

  // Show toast on successful save (detected via URL param)
  useEffect(() => {
    if (searchParams.get(savedParam) === "true") {
      setShowToast(true);
      setIsDirty(false);
      // Clean up the URL
      const url = new URL(window.location.href);
      url.searchParams.delete(savedParam);
      url.searchParams.delete("error");
      router.replace(url.pathname + url.search, { scroll: false });
    }
  }, [searchParams, savedParam, router]);

  const handleCloseToast = useCallback(() => setShowToast(false), []);

  return (
    <>
      <form ref={formRef} action={action} className={className}>
        {children}

        <div
          className="sticky bottom-0 z-10 mt-6 flex items-center justify-between rounded-b-2xl border-t bg-white px-6 py-4 dark:border-white/[0.05] dark:bg-gray-950"
          style={{ borderTopColor: "#E6E8EB" }}
        >
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {isDirty ? "You have unsaved changes" : ""}
          </span>
          <button
            type="submit"
            disabled={!isDirty}
            className="inline-flex items-center rounded-lg bg-[#2563EB] px-[18px] py-[10px] text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitLabel}
          </button>
        </div>
      </form>

      {showToast && (
        <Toast
          message={toastMessage}
          duration={5000}
          onClose={handleCloseToast}
        />
      )}
    </>
  );
}

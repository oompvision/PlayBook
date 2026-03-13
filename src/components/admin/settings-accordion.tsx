"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";

type SettingsAccordionProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  defaultOpen?: boolean;
  children: ReactNode;
  headerRight?: ReactNode;
};

export function SettingsAccordion({
  icon: Icon,
  title,
  description,
  defaultOpen = false,
  children,
  headerRight,
}: SettingsAccordionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-[18px] text-left border-b border-[#E6E8EB] dark:border-white/[0.05] cursor-pointer"
      >
        <Icon className="h-[18px] w-[18px] shrink-0 text-gray-500 dark:text-gray-400" />
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-gray-800 dark:text-white/90">
            {title}
          </h2>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            {description}
          </p>
        </div>
        {headerRight && (
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {headerRight}
          </div>
        )}
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-[180ms] ease-in-out ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-[180ms] ease-in-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="p-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

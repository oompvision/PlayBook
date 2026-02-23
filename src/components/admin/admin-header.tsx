"use client";

import React, { useRef, useEffect } from "react";
import { useSidebar } from "@/context/sidebar-context";
import { Menu, X, Search, Bell } from "lucide-react";

export function AdminHeader() {
  const { isMobileOpen, toggleMobileSidebar } = useSidebar();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-4 border-b border-gray-200 bg-white px-4 lg:px-6">
      {/* Mobile sidebar toggle */}
      <button
        onClick={toggleMobileSidebar}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 lg:hidden"
        aria-label="Toggle sidebar"
      >
        {isMobileOpen ? (
          <X className="h-5 w-5" />
        ) : (
          <Menu className="h-5 w-5" />
        )}
      </button>

      {/* Search bar */}
      <div className="hidden flex-1 lg:block">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search..."
            className="h-10 w-full rounded-lg border border-gray-200 bg-gray-50 pl-10 pr-14 text-sm text-gray-800 placeholder:text-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 select-none rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-gray-400">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Mobile spacer */}
      <div className="flex-1 lg:hidden" />

      {/* Right actions */}
      <div className="flex items-center gap-2">
        {/* Notifications */}
        <button className="relative flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100">
          <Bell className="h-5 w-5" />
          <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-red-500" />
        </button>

        {/* User avatar */}
        <button className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-sm font-medium text-white">
          A
        </button>
      </div>
    </header>
  );
}

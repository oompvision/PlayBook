"use client";

import React from "react";
import { useSidebar } from "@/context/sidebar-context";

export function AdminBackdrop() {
  const { isMobileOpen, toggleMobileSidebar } = useSidebar();

  if (!isMobileOpen) return null;

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 lg:hidden"
      onClick={toggleMobileSidebar}
    />
  );
}

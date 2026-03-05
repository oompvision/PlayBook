"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSidebar } from "@/context/sidebar-context";
import {
  LayoutDashboard,
  Building2,
  Calendar,
  CalendarCog,
  LayoutTemplate,
  CalendarCheck,
  Users,
  Crown,
  DollarSign,
  Settings,
  Layers,
  Ban,
  BadgeDollarSign,
  CalendarDays,
} from "lucide-react";

const baseNavItems = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Facilities", href: "/admin/bays", icon: Building2 },
];

const slotBasedNavItems = [
  { label: "Schedule", href: "/admin/schedule", icon: Calendar },
  { label: "Templates", href: "/admin/templates", icon: LayoutTemplate },
];

const dynamicNavItems = [
  { label: "Schedule Rules", href: "/admin/schedule/rules", icon: CalendarCog },
  { label: "Facility Groups", href: "/admin/bays/groups", icon: Layers },
  { label: "Block-Outs", href: "/admin/schedule/block-outs", icon: Ban },
  { label: "Rate Overrides", href: "/admin/schedule/rate-overrides", icon: BadgeDollarSign },
];

const commonNavItems = [
  { label: "Events", href: "/admin/events", icon: CalendarDays },
  { label: "Bookings", href: "/admin/bookings", icon: CalendarCheck },
  { label: "Customers", href: "/admin/customers", icon: Users },
  { label: "Revenue", href: "/admin/revenue", icon: DollarSign },
  { label: "Settings", href: "/admin/settings", icon: Settings },
];

export function AdminSidebar({
  slug,
  schedulingType = "slot_based",
  membershipEnabled = false,
}: {
  slug: string;
  schedulingType?: string;
  membershipEnabled?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isMobileOpen, toggleMobileSidebar } = useSidebar();

  const locationId = searchParams.get("location");

  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin";
    return pathname.startsWith(href);
  };

  const withLocation = (href: string) => {
    if (!locationId) return href;
    return `${href}?location=${locationId}`;
  };

  return (
    <aside
      className={`fixed top-0 left-0 z-50 flex h-screen w-[280px] flex-col bg-gray-900 transition-transform duration-300 ease-in-out ${
        isMobileOpen ? "translate-x-0" : "-translate-x-full"
      } lg:translate-x-0`}
    >
      {/* Facility branding */}
      <div className="flex h-16 items-center border-b border-gray-800 px-6">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold capitalize text-white">
            {slug.replace(/-/g, " ")}
          </h2>
          <p className="text-xs text-gray-500">Admin Dashboard</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {[
            ...baseNavItems,
            ...(schedulingType === "dynamic"
              ? dynamicNavItems
              : slotBasedNavItems),
            ...commonNavItems.slice(0, 2),
            ...(membershipEnabled
              ? [{ label: "Members", href: "/admin/members", icon: Crown }]
              : []),
            ...commonNavItems.slice(2),
          ].map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={withLocation(item.href)}
                  onClick={() => isMobileOpen && toggleMobileSidebar()}
                  className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-white/10 text-white"
                      : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                  }`}
                >
                  <Icon
                    className={`h-5 w-5 shrink-0 ${
                      active ? "text-blue-400" : "text-gray-500 group-hover:text-gray-400"
                    }`}
                  />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="border-t border-gray-800 px-6 py-4">
        <p className="text-xs text-gray-600">EZ Booker &copy; 2026</p>
      </div>
    </aside>
  );
}

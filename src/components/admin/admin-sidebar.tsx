"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSidebar } from "@/context/sidebar-context";
import {
  LayoutDashboard,
  Building2,
  Calendar,
  LayoutTemplate,
  CalendarCheck,
  Users,
  DollarSign,
  Settings,
} from "lucide-react";

const navItems = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Facilities", href: "/admin/bays", icon: Building2 },
  { label: "Schedule", href: "/admin/schedule", icon: Calendar },
  { label: "Templates", href: "/admin/templates", icon: LayoutTemplate },
  { label: "Bookings", href: "/admin/bookings", icon: CalendarCheck },
  { label: "Customers", href: "/admin/customers", icon: Users },
  { label: "Revenue", href: "/admin/revenue", icon: DollarSign },
  { label: "Settings", href: "/admin/settings", icon: Settings },
];

export function AdminSidebar({ slug }: { slug: string }) {
  const pathname = usePathname();
  const { isMobileOpen, toggleMobileSidebar } = useSidebar();

  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin";
    return pathname.startsWith(href);
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
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
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

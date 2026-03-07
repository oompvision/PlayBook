"use client";

import React, { useState } from "react";
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
  ChevronDown,
  CreditCard,
  Bell,
  CalendarClock,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type NavItem = { label: string; href: string; icon: LucideIcon };

const baseNavItems: NavItem[] = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Facilities", href: "/admin/bays", icon: Building2 },
];

const commonNavItems: NavItem[] = [
  { label: "Bookings", href: "/admin/bookings", icon: CalendarCheck },
  { label: "Customers", href: "/admin/customers", icon: Users },
  { label: "Revenue", href: "/admin/revenue", icon: DollarSign },
];

const settingsSubItems: NavItem[] = [
  { label: "Business Details", href: "/admin/settings/business-details", icon: Building2 },
  { label: "Scheduling Settings", href: "/admin/settings/scheduling", icon: CalendarClock },
  { label: "Payment Settings", href: "/admin/settings/payments", icon: CreditCard },
  { label: "Membership Management", href: "/admin/settings/membership", icon: Crown },
  { label: "Notifications", href: "/admin/settings/notifications", icon: Bell },
];

// Slot-based schedule sub-items (Templates is always shown, Events is conditional)
const slotBasedScheduleSubItems: NavItem[] = [
  { label: "Templates", href: "/admin/templates", icon: LayoutTemplate },
];

// Dynamic schedule sub-items
const dynamicScheduleSubItems: NavItem[] = [
  { label: "Facility Groups", href: "/admin/bays/groups", icon: Layers },
  { label: "Block-Outs", href: "/admin/schedule/block-outs", icon: Ban },
  { label: "Rate Overrides", href: "/admin/schedule/rate-overrides", icon: BadgeDollarSign },
];

function NavLink({
  item,
  isActive,
  withLocation,
  onNavigate,
}: {
  item: NavItem;
  isActive: boolean;
  withLocation: (href: string) => string;
  onNavigate: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={withLocation(item.href)}
      onClick={onNavigate}
      className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
        isActive
          ? "bg-white/10 text-white"
          : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
      }`}
    >
      <Icon
        className={`h-5 w-5 shrink-0 ${
          isActive ? "text-blue-400" : "text-gray-500 group-hover:text-gray-400"
        }`}
      />
      {item.label}
    </Link>
  );
}

function SubMenu({
  items,
  pathname,
  withLocation,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  withLocation: (href: string) => string;
  onNavigate: () => void;
}) {
  return (
    <ul className="mt-1 space-y-0.5 pl-4">
      {items.map((sub) => {
        const SubIcon = sub.icon;
        const subActive = pathname.startsWith(sub.href);
        return (
          <li key={sub.href}>
            <Link
              href={withLocation(sub.href)}
              onClick={onNavigate}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                subActive
                  ? "bg-white/5 font-medium text-white"
                  : "text-gray-500 hover:bg-white/5 hover:text-gray-300"
              }`}
            >
              <SubIcon
                className={`h-4 w-4 shrink-0 ${
                  subActive ? "text-blue-400" : "text-gray-600 group-hover:text-gray-500"
                }`}
              />
              {sub.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function DropdownNavItem({
  parentItem,
  subItems,
  isParentActive,
  isAnyChildActive,
  isOpen,
  onToggle,
  withLocation,
  onNavigate,
  pathname,
}: {
  parentItem: NavItem;
  subItems: NavItem[];
  isParentActive: boolean;
  isAnyChildActive: boolean;
  isOpen: boolean;
  onToggle: () => void;
  withLocation: (href: string) => string;
  onNavigate: () => void;
  pathname: string;
}) {
  const Icon = parentItem.icon;
  const highlighted = isParentActive || isAnyChildActive;

  return (
    <li>
      <Link
        href={withLocation(parentItem.href)}
        onClick={(e) => {
          // Always navigate. Toggle submenu open/closed.
          onToggle();
          // On mobile, close sidebar if navigating to the parent page
          if (!isAnyChildActive && !isParentActive) {
            onNavigate();
          }
        }}
        className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
          highlighted
            ? "bg-white/10 text-white"
            : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
        }`}
      >
        <Icon
          className={`h-5 w-5 shrink-0 ${
            highlighted ? "text-blue-400" : "text-gray-500 group-hover:text-gray-400"
          }`}
        />
        {parentItem.label}
        <ChevronDown
          className={`ml-auto h-4 w-4 shrink-0 transition-transform ${
            isOpen ? "rotate-0 text-gray-400" : "-rotate-90 text-gray-600"
          }`}
        />
      </Link>

      {isOpen && (
        <SubMenu
          items={subItems}
          pathname={pathname}
          withLocation={withLocation}
          onNavigate={onNavigate}
        />
      )}
    </li>
  );
}

export function AdminSidebar({
  slug,
  schedulingType = "slot_based",
  membershipEnabled = false,
  eventsEnabled = false,
}: {
  slug: string;
  schedulingType?: string;
  membershipEnabled?: boolean;
  eventsEnabled?: boolean;
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

  const closeMobile = () => {
    if (isMobileOpen) toggleMobileSidebar();
  };

  // Build schedule dropdown config based on scheduling type
  const isDynamic = schedulingType === "dynamic";

  const scheduleParent: NavItem = isDynamic
    ? { label: "Schedule Rules", href: "/admin/schedule/rules", icon: CalendarCog }
    : { label: "Schedule", href: "/admin/schedule", icon: Calendar };

  const eventsItem: NavItem[] = eventsEnabled
    ? [{ label: "Events", href: "/admin/events", icon: CalendarDays }]
    : [];

  const scheduleChildren: NavItem[] = isDynamic
    ? [...dynamicScheduleSubItems, ...eventsItem]
    : [...slotBasedScheduleSubItems, ...eventsItem];

  // All hrefs that count as "schedule section" for auto-open
  const allScheduleHrefs = [scheduleParent.href, ...scheduleChildren.map((c) => c.href)];
  const isOnSchedulePage = allScheduleHrefs.some((href) => pathname.startsWith(href));
  const isScheduleParentActive = pathname === scheduleParent.href || pathname.startsWith(scheduleParent.href + "/");
  const isScheduleChildActive = scheduleChildren.some((c) => pathname.startsWith(c.href));

  // Schedule dropdown: auto-open when on a schedule page, remember toggle otherwise
  const [scheduleManualOpen, setScheduleManualOpen] = useState(isOnSchedulePage);

  const isScheduleOpen = isOnSchedulePage || scheduleManualOpen;

  const handleScheduleToggle = () => {
    if (isOnSchedulePage) {
      // On a schedule page: toggling collapses/expands
      setScheduleManualOpen((prev) => !prev);
    } else {
      // Navigating to schedule: open it
      setScheduleManualOpen(true);
    }
  };

  // Settings section
  const isSettingsActive = pathname.startsWith("/admin/settings");
  const [settingsManualOpen, setSettingsManualOpen] = useState(isSettingsActive);
  const isSettingsOpen = isSettingsActive || settingsManualOpen;

  const handleSettingsToggle = () => {
    if (isSettingsActive) {
      setSettingsManualOpen((prev) => !prev);
    } else {
      setSettingsManualOpen(true);
    }
  };

  // Flat nav items (everything except schedule dropdown and settings dropdown)
  const flatNavItems: NavItem[] = [
    ...baseNavItems,
    // Bookings comes after schedule section
  ];

  const postScheduleItems: NavItem[] = [
    ...commonNavItems.slice(0, 1), // Bookings
    ...(membershipEnabled
      ? [{ label: "Members", href: "/admin/members", icon: Crown } as NavItem]
      : []),
    ...commonNavItems.slice(1), // Customers, Revenue
  ];

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
          {/* Base items: Dashboard, Facilities */}
          {flatNavItems.map((item) => (
            <li key={item.href}>
              <NavLink
                item={item}
                isActive={isActive(item.href)}
                withLocation={withLocation}
                onNavigate={closeMobile}
              />
            </li>
          ))}

          {/* Schedule Dropdown */}
          <DropdownNavItem
            parentItem={scheduleParent}
            subItems={scheduleChildren}
            isParentActive={
              isDynamic
                ? pathname === "/admin/schedule/rules"
                : pathname === "/admin/schedule" || pathname === "/admin/schedule/day"
            }
            isAnyChildActive={isScheduleChildActive}
            isOpen={isScheduleOpen}
            onToggle={handleScheduleToggle}
            withLocation={withLocation}
            onNavigate={closeMobile}
            pathname={pathname}
          />

          {/* Post-schedule items: Bookings, Members, Customers, Revenue */}
          {postScheduleItems.map((item) => (
            <li key={item.href}>
              <NavLink
                item={item}
                isActive={isActive(item.href)}
                withLocation={withLocation}
                onNavigate={closeMobile}
              />
            </li>
          ))}

          {/* Settings Dropdown */}
          <DropdownNavItem
            parentItem={{ label: "Settings", href: "/admin/settings/business-details", icon: Settings }}
            subItems={settingsSubItems}
            isParentActive={false}
            isAnyChildActive={isSettingsActive}
            isOpen={isSettingsOpen}
            onToggle={handleSettingsToggle}
            withLocation={withLocation}
            onNavigate={closeMobile}
            pathname={pathname}
          />
        </ul>
      </nav>

      {/* Footer */}
      <div className="border-t border-gray-800 px-6 py-4">
        <p className="text-xs text-gray-600">EZ Booker &copy; 2026</p>
      </div>
    </aside>
  );
}

"use client";

import { useState } from "react";
import {
  CalendarClock,
  DollarSign,
  Users,
  CreditCard,
  MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface FeatureTab {
  title: string;
  icon: LucideIcon;
  shortDesc: string;
  details: string;
  mockup: React.ReactNode;
}

function SchedulingMockup() {
  return (
    <div className="w-full h-full bg-white p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-3 h-3 rounded bg-brand/30" />
        <div className="text-[10px] font-semibold text-gray-600">Weekly Schedule View</div>
      </div>
      {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day, i) => (
        <div key={day} className="flex items-center gap-2">
          <span className="text-[9px] font-medium text-gray-500 w-6">{day}</span>
          <div className="flex-1 flex gap-1">
            {Array.from({ length: 6 }, (_, j) => (
              <div
                key={j}
                className={cn(
                  "flex-1 h-5 rounded-sm",
                  (i + j) % 3 === 0 ? "bg-brand/25" : (i + j) % 4 === 0 ? "bg-blue-100" : "bg-gray-100"
                )}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PricingMockup() {
  return (
    <div className="w-full h-full bg-white p-4 flex flex-col gap-3">
      <div className="text-[10px] font-semibold text-gray-600 mb-1">Dynamic Price Rules</div>
      {[
        { label: "Peak Hours (5-9 PM)", price: "$65/hr", color: "bg-red-100 text-red-700" },
        { label: "Standard (9 AM-5 PM)", price: "$45/hr", color: "bg-brand/10 text-brand" },
        { label: "Off-Peak (6-9 AM)", price: "$30/hr", color: "bg-blue-50 text-blue-600" },
      ].map((rule) => (
        <div key={rule.label} className="flex items-center justify-between p-2 rounded-lg border border-gray-100">
          <span className="text-[9px] text-gray-700">{rule.label}</span>
          <span className={cn("text-[9px] font-bold px-2 py-0.5 rounded-full", rule.color)}>{rule.price}</span>
        </div>
      ))}
      <div className="mt-auto flex gap-1">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex-1 flex flex-col-reverse gap-0.5">
            <div className="h-2 bg-gray-200 rounded-sm" />
            <div className={`rounded-sm bg-brand/30`} style={{ height: `${12 + Math.sin(i) * 8}px` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function MembershipMockup() {
  return (
    <div className="w-full h-full bg-white p-4 flex flex-col gap-2">
      <div className="text-[10px] font-semibold text-gray-600 mb-1">Member Dashboard</div>
      {[
        { name: "Gold Members", count: "124", badge: "bg-yellow-100 text-yellow-700" },
        { name: "Silver Members", count: "89", badge: "bg-gray-100 text-gray-700" },
        { name: "Day Pass Holders", count: "37", badge: "bg-blue-50 text-blue-600" },
      ].map((tier) => (
        <div key={tier.name} className="flex items-center justify-between p-2 rounded-lg border border-gray-100">
          <div className="flex items-center gap-2">
            <div className={cn("w-2 h-2 rounded-full", tier.badge.split(" ")[0])} />
            <span className="text-[9px] text-gray-700">{tier.name}</span>
          </div>
          <span className={cn("text-[9px] font-bold px-2 py-0.5 rounded-full", tier.badge)}>{tier.count}</span>
        </div>
      ))}
      <div className="mt-auto p-2 bg-brand-lightBg rounded-lg">
        <div className="text-[8px] text-gray-500">Renewal rate</div>
        <div className="text-sm font-bold text-brand">92%</div>
      </div>
    </div>
  );
}

function PaymentsMockup() {
  return (
    <div className="w-full h-full bg-white p-4 flex flex-col gap-2">
      <div className="text-[10px] font-semibold text-gray-600 mb-1">Recent Transactions</div>
      {[
        { name: "Court 2 — 6:00 PM", amount: "$65.00", status: "Paid" },
        { name: "Sim 1 — 3:00 PM", amount: "$45.00", status: "Paid" },
        { name: "Court 1 — 7:00 PM", amount: "$65.00", status: "Pending" },
      ].map((tx) => (
        <div key={tx.name} className="flex items-center justify-between p-2 rounded-lg border border-gray-100">
          <span className="text-[9px] text-gray-700">{tx.name}</span>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold text-gray-900">{tx.amount}</span>
            <span className={cn("text-[8px] px-1.5 py-0.5 rounded-full", tx.status === "Paid" ? "bg-brand-lightBg text-brand" : "bg-yellow-50 text-yellow-700")}>{tx.status}</span>
          </div>
        </div>
      ))}
      <div className="mt-auto p-2 bg-brand-lightBg rounded-lg flex items-center justify-between">
        <div className="text-[8px] text-gray-500">Today&apos;s revenue</div>
        <div className="text-sm font-bold text-brand">$1,240</div>
      </div>
    </div>
  );
}

function MultiLocationMockup() {
  return (
    <div className="w-full h-full bg-white p-4 flex flex-col gap-2">
      <div className="text-[10px] font-semibold text-gray-600 mb-1">Your Locations</div>
      {[
        { name: "Downtown", courts: 6, util: "87%" },
        { name: "Westside", courts: 4, util: "72%" },
        { name: "North Campus", courts: 8, util: "91%" },
      ].map((loc) => (
        <div key={loc.name} className="p-2 rounded-lg border border-gray-100 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-medium text-gray-700">{loc.name}</span>
            <span className="text-[8px] text-gray-500">{loc.courts} courts</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div className="bg-brand/40 h-1.5 rounded-full" style={{ width: loc.util }} />
          </div>
          <div className="text-[8px] text-brand font-semibold">{loc.util} utilization</div>
        </div>
      ))}
    </div>
  );
}

const featureTabs: FeatureTab[] = [
  {
    title: "Scheduling",
    icon: CalendarClock,
    shortDesc: "Drag-and-drop complex multi-court bookings.",
    details: "Instantly view facility-wide availability. Change court assignments in two clicks. Support for recurring bookings, block schedules, and group reservations.",
    mockup: <SchedulingMockup />,
  },
  {
    title: "Dynamic Pricing",
    icon: DollarSign,
    shortDesc: "Adjust pricing based on peak hours and demand.",
    details: "Fill slow spots automatically. Maximize per-court revenue during prime time. Set rules once and let the system optimize your pricing around the clock.",
    mockup: <PricingMockup />,
  },
  {
    title: "Membership & Passes",
    icon: Users,
    shortDesc: "Manage player plans, tiered access, and court credits.",
    details: "Tiered access for premium courts. Automate renewal reminders and credit packages. Track member engagement and retention metrics at a glance.",
    mockup: <MembershipMockup />,
  },
  {
    title: "Payments",
    icon: CreditCard,
    shortDesc: "Secure, integrated payment processing.",
    details: "Accept payments upfront, hold cards, or collect at the facility. Automated invoicing, refund handling, and detailed revenue reporting built in.",
    mockup: <PaymentsMockup />,
  },
  {
    title: "Multi-Location",
    icon: MapPin,
    shortDesc: "Manage all your facilities from one dashboard.",
    details: "Centralized management across all locations. Compare utilization rates, revenue, and booking patterns. Standard feature — no upsell required.",
    mockup: <MultiLocationMockup />,
  },
];

export function FeaturesSection() {
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const activeFeature = featureTabs[activeTabIndex];

  return (
    <section id="features" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <div className="text-brand font-semibold text-sm tracking-widest uppercase mb-2">
            Platform Features
          </div>
          <h2 className="text-4xl md:text-5xl font-extrabold text-gray-950 font-[family-name:var(--font-heading)]">
            Everything to grow your facility.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr,2fr] gap-12 items-start">
          {/* Left: Tabs */}
          <div className="space-y-3">
            {featureTabs.map((feature, index) => (
              <button
                key={feature.title}
                onClick={() => setActiveTabIndex(index)}
                className={cn(
                  "w-full text-left p-5 rounded-2xl transition-all duration-300 flex gap-4 items-center",
                  activeTabIndex === index
                    ? "bg-brand text-white shadow-lg scale-[1.03]"
                    : "bg-brand-lightBg hover:bg-green-100 hover:scale-[1.01]"
                )}
              >
                <div
                  className={cn(
                    "p-3 rounded-lg",
                    activeTabIndex === index ? "bg-brand-dark/40" : "bg-green-100"
                  )}
                >
                  <feature.icon
                    className={cn(
                      "h-5 w-5",
                      activeTabIndex === index ? "text-white" : "text-brand"
                    )}
                  />
                </div>
                <div>
                  <h4
                    className={cn(
                      "font-bold text-lg",
                      activeTabIndex === index ? "text-white" : "text-gray-950"
                    )}
                  >
                    {feature.title}
                  </h4>
                  <p
                    className={cn(
                      "text-sm",
                      activeTabIndex === index ? "text-green-100" : "text-gray-700"
                    )}
                  >
                    {feature.shortDesc}
                  </p>
                </div>
              </button>
            ))}
          </div>

          {/* Right: Preview */}
          <div className="bg-brand-lightBg rounded-2xl p-4 md:p-10 shadow-inner">
            <div className="aspect-[16/10] bg-white rounded-xl shadow-2xl overflow-hidden border border-gray-100 mb-8">
              {activeFeature.mockup}
            </div>
            <div className="max-w-xl">
              <h3 className="text-3xl font-extrabold text-gray-950 mb-3 tracking-tight">
                {activeFeature.title}
              </h3>
              <p className="text-lg text-gray-700 leading-relaxed">
                {activeFeature.details}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

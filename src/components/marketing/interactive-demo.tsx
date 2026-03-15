"use client";

import { useState, Suspense } from "react";
import { cn } from "@/lib/utils";
import { CalendarCheck, Settings, Loader2 } from "lucide-react";
import { DynamicAvailabilityWidget } from "@/components/dynamic-availability-widget";
import { DynamicRulesEditor } from "@/components/admin/dynamic-rules-editor";

type Bay = {
  id: string;
  name: string;
  resource_type: string | null;
};

type BayWithRate = Bay & {
  hourly_rate_cents: number;
};

type FacilityGroup = {
  id: string;
  name: string;
  description: string | null;
  bays: Bay[];
};

type DbRule = {
  id: string;
  bay_id: string;
  org_id: string;
  day_of_week: number;
  open_time: string;
  close_time: string;
  available_durations: number[];
  buffer_minutes: number;
  start_time_granularity: number;
  rate_tiers: Array<{
    type?: "rate" | "blockout";
    start_time: string;
    end_time: string;
    hourly_rate_cents: number;
  }>;
  location_id: string | null;
  created_at: string;
  updated_at: string;
};

interface InteractiveDemoProps {
  orgId: string;
  orgName: string;
  timezone: string;
  todayStr: string;
  bays: Bay[];
  baysWithRates: BayWithRate[];
  facilityGroups: FacilityGroup[];
  standaloneBays: Bay[];
  defaultDurations: number[];
  existingRules: DbRule[];
  bookableWindowDays: number;
  minBookingLeadMinutes: number;
  paymentMode: string;
}

const tabs = [
  {
    id: "player" as const,
    label: "The Player Experience",
    icon: CalendarCheck,
    description: "Browse availability and book a court — just like your customers will.",
  },
  {
    id: "admin" as const,
    label: "The Admin Experience",
    icon: Settings,
    description: "Configure schedule rules, rate tiers, and operating hours.",
  },
];

export function InteractiveDemo({
  orgId,
  orgName,
  timezone,
  todayStr,
  bays,
  baysWithRates,
  facilityGroups,
  standaloneBays,
  defaultDurations,
  existingRules,
  bookableWindowDays,
  minBookingLeadMinutes,
  paymentMode,
}: InteractiveDemoProps) {
  const [activeTab, setActiveTab] = useState<"player" | "admin">("player");

  return (
    <section id="features" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="text-brand font-semibold text-sm tracking-widest uppercase mb-2">
            Interactive Demo
          </div>
          <h2 className="text-4xl md:text-5xl font-extrabold text-gray-950 font-[family-name:var(--font-heading)]">
            Try it yourself.{" "}
            <span className="text-brand">Right now.</span>
          </h2>
          <p className="text-xl text-gray-600 mt-4 leading-relaxed">
            No signup required. Experience EZBooker from both sides — as a player booking a court,
            and as an admin managing your facility.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex justify-center gap-4 mb-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-3 px-6 py-3.5 rounded-full text-sm font-semibold transition-all",
                activeTab === tab.id
                  ? "bg-brand text-white shadow-lg"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab description */}
        <p className="text-center text-gray-500 text-sm mb-8">
          {tabs.find((t) => t.id === activeTab)?.description}
        </p>

        {/* Demo Content */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-xl overflow-hidden">
          {/* Browser chrome */}
          <div className="flex items-center gap-1.5 px-4 py-3 bg-gray-50 border-b border-gray-200">
            <div className="w-3 h-3 rounded-full bg-red-400" />
            <div className="w-3 h-3 rounded-full bg-yellow-400" />
            <div className="w-3 h-3 rounded-full bg-green-400" />
            <div className="ml-3 flex-1 bg-white rounded h-6 border border-gray-200 flex items-center px-3">
              <span className="text-xs text-gray-400">
                {activeTab === "player"
                  ? `${orgName.toLowerCase().replace(/\s+/g, "")}.ezbooker.app`
                  : `${orgName.toLowerCase().replace(/\s+/g, "")}.ezbooker.app/admin/schedule/rules`}
              </span>
            </div>
          </div>

          {/* Widget area */}
          <div className={cn(
            "min-h-[500px]",
            activeTab === "admin" && "bg-[#F6F7F8]"
          )}>
            {activeTab === "player" ? (
              <div className="p-4 md:p-6">
                <Suspense
                  fallback={
                    <div className="flex items-center justify-center py-24">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  }
                >
                  <DynamicAvailabilityWidget
                    orgId={orgId}
                    orgName={orgName}
                    timezone={timezone}
                    bays={bays}
                    facilityGroups={facilityGroups}
                    standaloneBays={standaloneBays}
                    defaultDurations={defaultDurations}
                    todayStr={todayStr}
                    minBookingLeadMinutes={minBookingLeadMinutes}
                    bookableWindowDays={bookableWindowDays}
                    paymentMode={paymentMode}
                    demoMode
                  />
                </Suspense>
              </div>
            ) : (
              <div className="p-4 md:p-6">
                <DynamicRulesEditor
                  orgId={orgId}
                  locationId={null}
                  bays={baysWithRates}
                  existingRules={existingRules}
                  readOnly
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

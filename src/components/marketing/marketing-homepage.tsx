"use client";

import { useState } from "react";
import { MarketingNav } from "./marketing-nav";
import { HeroSection } from "./hero-section";
import { InteractiveDemo } from "./interactive-demo";
import { FeaturesSection } from "./features-section";
import { ForPlayersSection } from "./for-players-section";
import { PricingSection } from "./pricing-section";
import { CtaBanner } from "./cta-banner";
import { MarketingFooter } from "./marketing-footer";
import { DemoModal } from "./demo-modal";
import { ContactModal } from "./contact-modal";

export type DemoOrgData = {
  orgId: string;
  orgName: string;
  timezone: string;
  todayStr: string;
  bays: Array<{ id: string; name: string; resource_type: string | null }>;
  baysWithRates: Array<{ id: string; name: string; resource_type: string | null; hourly_rate_cents: number }>;
  facilityGroups: Array<{
    id: string;
    name: string;
    description: string | null;
    bays: Array<{ id: string; name: string; resource_type: string | null }>;
  }>;
  standaloneBays: Array<{ id: string; name: string; resource_type: string | null }>;
  defaultDurations: number[];
  existingRules: Array<{
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
  }>;
  bookableWindowDays: number;
  minBookingLeadMinutes: number;
};

interface MarketingHomepageProps {
  authInfo?: {
    role: string;
    orgId: string | null;
  } | null;
  demoData?: DemoOrgData | null;
}

export function MarketingHomepage({ authInfo, demoData }: MarketingHomepageProps) {
  const [demoOpen, setDemoOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const openDemo = () => setDemoOpen(true);
  const openContact = () => setContactOpen(true);

  return (
    <div className="min-h-screen flex flex-col">
      <MarketingNav onOpenDemo={openDemo} onOpenContact={openContact} authInfo={authInfo} />
      <main className="flex-1">
        <HeroSection onOpenDemo={openDemo} />
        {demoData ? (
          <InteractiveDemo {...demoData} />
        ) : (
          <FeaturesSection />
        )}
        <ForPlayersSection />
        <PricingSection onOpenDemo={openDemo} />
        <CtaBanner onOpenDemo={openDemo} />
      </main>
      <MarketingFooter onOpenContact={openContact} />
      <DemoModal open={demoOpen} onOpenChange={setDemoOpen} />
      <ContactModal open={contactOpen} onOpenChange={setContactOpen} />
    </div>
  );
}

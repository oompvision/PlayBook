"use client";

import { useState } from "react";
import { MarketingNav } from "./marketing-nav";
import { HeroSection } from "./hero-section";
import { FacilityTypesStrip } from "./facility-types-strip";
import { FeaturesSection } from "./features-section";
import { ForPlayersSection } from "./for-players-section";
import { PricingSection } from "./pricing-section";
import { CtaBanner } from "./cta-banner";
import { MarketingFooter } from "./marketing-footer";
import { DemoModal } from "./demo-modal";

interface MarketingHomepageProps {
  authInfo?: {
    role: string;
    orgId: string | null;
  } | null;
}

export function MarketingHomepage({ authInfo }: MarketingHomepageProps) {
  const [demoOpen, setDemoOpen] = useState(false);
  const openDemo = () => setDemoOpen(true);

  return (
    <div className="min-h-screen flex flex-col">
      <MarketingNav onOpenDemo={openDemo} authInfo={authInfo} />
      <main className="flex-1">
        <HeroSection onOpenDemo={openDemo} />
        <FacilityTypesStrip />
        <FeaturesSection />
        <ForPlayersSection />
        <PricingSection onOpenDemo={openDemo} />
        <CtaBanner onOpenDemo={openDemo} />
      </main>
      <MarketingFooter />
      <DemoModal open={demoOpen} onOpenChange={setDemoOpen} />
    </div>
  );
}

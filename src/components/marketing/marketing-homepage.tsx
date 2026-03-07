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
import { ContactModal } from "./contact-modal";

interface MarketingHomepageProps {
  authInfo?: {
    role: string;
    orgId: string | null;
  } | null;
}

export function MarketingHomepage({ authInfo }: MarketingHomepageProps) {
  const [demoOpen, setDemoOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const openDemo = () => setDemoOpen(true);
  const openContact = () => setContactOpen(true);

  return (
    <div className="min-h-screen flex flex-col">
      <MarketingNav onOpenDemo={openDemo} onOpenContact={openContact} authInfo={authInfo} />
      <main className="flex-1">
        <HeroSection onOpenDemo={openDemo} onOpenContact={openContact} />
        <FacilityTypesStrip />
        <FeaturesSection />
        <ForPlayersSection />
        <PricingSection onOpenDemo={openDemo} />
        <CtaBanner onOpenDemo={openDemo} onOpenContact={openContact} />
      </main>
      <MarketingFooter onOpenContact={openContact} />
      <DemoModal open={demoOpen} onOpenChange={setDemoOpen} />
      <ContactModal open={contactOpen} onOpenChange={setContactOpen} />
    </div>
  );
}

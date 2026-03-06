import { Button } from "@/components/ui/button";
import { BadgeDollarSign } from "lucide-react";
import { ScrollFadeIn } from "./scroll-fade-in";

interface PricingSectionProps {
  onOpenDemo: () => void;
}

export function PricingSection({ onOpenDemo }: PricingSectionProps) {
  return (
    <section id="pricing" className="py-20 md:py-28 bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <ScrollFadeIn>
          <div className="text-center mb-12">
            <p className="text-sm font-semibold uppercase tracking-wider text-green-600 mb-3">
              Pricing
            </p>
            <h2 className="font-[family-name:var(--font-heading)] text-3xl sm:text-4xl md:text-5xl font-bold text-gray-900">
              Simple pricing.{" "}
              <span className="text-green-600">No surprises.</span>
            </h2>
            <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
              One flat monthly fee. Every feature included. No upsells, no tiers, no nickel-and-diming.
            </p>
          </div>
        </ScrollFadeIn>

        <ScrollFadeIn delay={100}>
          <div className="mx-auto max-w-xl">
            <div className="rounded-2xl border-2 border-green-200 bg-green-50 p-8 text-center">
              <div className="flex justify-center mb-4">
                <BadgeDollarSign className="h-10 w-10 text-green-600" />
              </div>
              <p className="text-xl sm:text-2xl font-bold text-gray-900 font-[family-name:var(--font-heading)]">
                We guarantee to cut your current booking software cost by 33% or more.
              </p>
            </div>

            <div className="mt-8 text-center">
              <Button
                size="lg"
                className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 text-base"
                onClick={onOpenDemo}
              >
                Contact Us for Pricing
              </Button>
              <p className="mt-4 text-sm text-muted-foreground">
                Pricing scales with your number of locations. Multi-location support included standard.
              </p>
            </div>
          </div>
        </ScrollFadeIn>
      </div>
    </section>
  );
}

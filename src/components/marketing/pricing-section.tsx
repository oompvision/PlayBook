"use client";

import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface PricingSectionProps {
  onOpenDemo: () => void;
}

const pricingData = [
  {
    tier: "Startup",
    price: "Contact Us",
    units: "",
    target: "Perfect for new facilities with 1-4 courts.",
    features: [
      "Multi-Activity Calendar",
      "Secure Payments",
      "Email Support",
      "1 Admin Seat",
    ],
    cta: "Get Started",
    primary: false,
  },
  {
    tier: "Growth",
    price: "Contact Us",
    units: "",
    target: "For busy facilities needing advanced tools.",
    features: [
      "Includes All Startup",
      "Dynamic Pricing",
      "Membership Management",
      "3 Admin Seats",
      "Priority Support",
    ],
    cta: "Scale Your Business",
    primary: true,
  },
  {
    tier: "Enterprise",
    price: "Contact Us",
    units: "",
    target: "Custom solutions for high-volume, multi-location facilities.",
    features: [
      "Includes All Growth",
      "API Access",
      "Custom Integrations",
      "Dedicated Account Manager",
      "SLA Guarantee",
    ],
    cta: "Let\u2019s Connect",
    primary: false,
  },
];

export function PricingSection({ onOpenDemo }: PricingSectionProps) {
  return (
    <section id="pricing" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-4xl md:text-5xl font-extrabold text-gray-950 font-[family-name:var(--font-heading)]">
            Simple pricing.{" "}
            <span className="text-brand">No surprises.</span>
          </h2>
          <p className="text-xl text-gray-700 mt-4 leading-relaxed">
            Choose the plan that fits your current operational scale. All plans
            include core scheduling and payment features.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
          {pricingData.map((plan) => (
            <div
              key={plan.tier}
              className={cn(
                "bg-brand-lightBg p-8 rounded-3xl shadow-sm border transition-all",
                plan.primary
                  ? "border-brand shadow-lg md:scale-105"
                  : "border-gray-100"
              )}
            >
              <h4 className="text-xl font-bold text-gray-950 mb-1">
                {plan.tier}
              </h4>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-4xl font-extrabold text-gray-950">
                  {plan.price}
                </span>
                {plan.units && (
                  <span className="text-sm text-gray-600 font-medium">
                    {plan.units}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-700 mb-8 font-medium">
                {plan.target}
              </p>

              <ul className="space-y-4 mb-10 text-gray-800 text-sm font-medium border-t border-gray-200 pt-8">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2.5 items-center">
                    <Check className="h-4 w-4 text-brand flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={onOpenDemo}
                className={cn(
                  "w-full py-3.5 rounded-full text-lg font-bold transition-colors",
                  plan.primary
                    ? "bg-brand text-white hover:bg-brand-dark"
                    : "bg-white text-gray-900 border border-gray-200 hover:bg-gray-100"
                )}
              >
                {plan.cta}
              </button>
            </div>
          ))}
        </div>

        {/* Guarantee Block */}
        <div className="mt-20 max-w-3xl mx-auto bg-brand-lightBg rounded-3xl p-10 text-center shadow-inner border border-brand-light/20 flex flex-col items-center gap-6">
          <div className="bg-brand text-white p-4 rounded-full">
            <Check className="h-6 w-6" />
          </div>
          <h3 className="text-3xl font-extrabold text-gray-950 tracking-tight">
            The EZBooker Performance Guarantee
          </h3>
          <p className="text-lg text-gray-700 max-w-xl">
            If we cannot prove we can reduce your operational costs or increase
            your utilization by at least 25%, we will give you{" "}
            <strong>one year free</strong>. Guaranteed.
          </p>
          <button
            onClick={onOpenDemo}
            className="bg-brand text-white px-8 py-3 rounded-full text-lg font-bold hover:bg-brand-dark transition-all transform hover:scale-[1.03]"
          >
            Request an ROI Assessment
          </button>
        </div>
      </div>
    </section>
  );
}

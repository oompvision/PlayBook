"use client";

import Image from "next/image";

interface HeroSectionProps {
  onOpenDemo: () => void;
}

export function HeroSection({ onOpenDemo }: HeroSectionProps) {
  return (
    <section className="bg-brand-lightBg py-20 lg:py-32 overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        {/* Left Column: Copy & CTA */}
        <div className="space-y-6">
          <div className="inline-block bg-white text-brand px-4 py-1.5 rounded-full text-sm font-semibold border border-brand-light/30 shadow-sm">
            #1 Software for Modern Athletic Facilities
          </div>

          <h1 className="text-5xl lg:text-6xl font-extrabold text-gray-950 font-[family-name:var(--font-heading)] leading-tight">
            Run your facility.{" "}
            <span className="text-brand">Maximize your revenue.</span>
          </h1>

          <p className="text-xl text-gray-700 max-w-lg">
            EZBooker handles all complex bookings, payments, and member management.
            Less admin, more utilization.
            <span className="font-semibold block mt-1 text-gray-900">
              Proven to reduce administrative work by 40%.
            </span>
          </p>

          {/* Primary CTAs */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pt-4">
            <button
              onClick={onOpenDemo}
              className="bg-brand text-white px-8 py-3.5 rounded-full text-lg font-bold hover:bg-brand-dark transition-all transform hover:scale-[1.03] shadow-md"
            >
              Schedule a Product Tour
            </button>
            <a
              href="#features"
              className="text-gray-900 font-semibold group flex items-center gap-2"
            >
              Explore All Features
              <span className="group-hover:translate-x-1 transition-transform">&rarr;</span>
            </a>
          </div>

        </div>

        {/* Right Column: iPhone Mockup */}
        <div className="flex justify-center lg:justify-end">
          <div className="relative group">
            {/* Glow effect on hover */}
            <div className="absolute -inset-4 bg-gradient-to-r from-brand-light to-blue-400 rounded-[3.5rem] blur-2xl opacity-0 group-hover:opacity-20 transition-opacity duration-500" />

            {/* iPhone 16 Pro frame */}
            <div className="relative w-[280px] sm:w-[300px] bg-[#1a1a1a] rounded-[3rem] p-[10px] shadow-2xl ring-1 ring-black/10">
              {/* Side button accents */}
              <div className="absolute -left-[2px] top-[120px] w-[3px] h-[28px] bg-[#2a2a2a] rounded-l-sm" />
              <div className="absolute -left-[2px] top-[160px] w-[3px] h-[50px] bg-[#2a2a2a] rounded-l-sm" />
              <div className="absolute -left-[2px] top-[218px] w-[3px] h-[50px] bg-[#2a2a2a] rounded-l-sm" />
              <div className="absolute -right-[2px] top-[170px] w-[3px] h-[70px] bg-[#2a2a2a] rounded-r-sm" />

              {/* Screen */}
              <div className="relative bg-white rounded-[2.4rem] overflow-hidden">
                {/* Dynamic Island */}
                <div className="absolute top-[10px] left-1/2 -translate-x-1/2 w-[90px] h-[26px] bg-black rounded-full z-10" />

                {/* Screenshot */}
                <Image
                  src="/demo-booking.png"
                  alt="EZBooker mobile booking experience"
                  width={600}
                  height={1300}
                  className="w-full h-auto"
                  priority
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

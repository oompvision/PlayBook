"use client";

interface HeroSectionProps {
  onOpenDemo: () => void;
}

function DashboardMockup() {
  const bays = ["Court 1", "Court 2", "Court 3", "Sim 1", "Sim 2"];
  const hours = ["9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM", "3 PM", "4 PM"];

  const booked: Record<string, number[]> = {
    "Court 1": [0, 1, 4, 5],
    "Court 2": [2, 3, 6],
    "Court 3": [1, 3, 4, 7],
    "Sim 1": [0, 2, 5, 6, 7],
    "Sim 2": [1, 4, 5],
  };

  return (
    <div className="p-3 space-y-2">
      {/* Toolbar mockup */}
      <div className="flex items-center justify-between px-2 py-1.5">
        <div className="flex items-center gap-2">
          <div className="w-20 h-3 bg-gray-200 rounded" />
          <div className="w-16 h-3 bg-gray-100 rounded" />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-6 bg-brand/10 rounded" />
          <div className="w-14 h-6 bg-brand rounded text-[8px] text-white flex items-center justify-center font-medium">Today</div>
          <div className="w-6 h-6 bg-brand/10 rounded" />
        </div>
      </div>
      {/* Calendar grid */}
      <div className="overflow-hidden rounded-lg border border-gray-100">
        <div className="grid gap-px bg-gray-100" style={{ gridTemplateColumns: `64px repeat(${hours.length}, 1fr)` }}>
          <div className="bg-gray-50 p-1.5" />
          {hours.map((h) => (
            <div key={h} className="bg-gray-50 p-1.5 text-[7px] font-medium text-gray-500 text-center">{h}</div>
          ))}
        </div>
        {bays.map((bay) => (
          <div key={bay} className="grid gap-px bg-gray-100" style={{ gridTemplateColumns: `64px repeat(${hours.length}, 1fr)` }}>
            <div className="bg-white p-1.5 text-[7px] font-medium text-gray-700 flex items-center">{bay}</div>
            {hours.map((_, i) => {
              const isBooked = booked[bay]?.includes(i);
              return (
                <div key={i} className={`p-1 ${isBooked ? "bg-brand/15" : "bg-white"}`}>
                  {isBooked && <div className="w-full h-3 bg-brand/30 rounded-sm" />}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
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

          {/* Social Proof */}
          <div className="pt-10 border-t border-gray-200 mt-10">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
              Trusted by Leading Facilities
            </p>
            <div className="flex items-center gap-8 opacity-50">
              {["Ace Tennis Club", "Pickleball USA", "Golf Zone"].map((name) => (
                <span key={name} className="text-sm font-bold text-gray-400 tracking-wide">
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Browser Mockup */}
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-brand-light to-blue-400 rounded-2xl blur-xl opacity-0 group-hover:opacity-30 transition-opacity duration-500" />

          <div className="relative bg-white p-2 rounded-2xl shadow-2xl border border-gray-100">
            <div className="flex items-center gap-1.5 p-3 border-b border-gray-100">
              <div className="w-3 h-3 rounded-full bg-red-400" />
              <div className="w-3 h-3 rounded-full bg-yellow-400" />
              <div className="w-3 h-3 rounded-full bg-green-400" />
              <div className="ml-3 flex-1 bg-gray-100 rounded h-5 flex items-center px-2">
                <span className="text-[9px] text-gray-400">ezbooker.app/admin/schedule</span>
              </div>
            </div>
            <DashboardMockup />
          </div>
        </div>
      </div>
    </section>
  );
}

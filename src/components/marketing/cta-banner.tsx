"use client";

interface FinalCtaProps {
  onOpenDemo: () => void;
}

function CaseStudyChart() {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const before = [45, 48, 42, 50, 47, 46];
  const after = [52, 58, 63, 68, 72, 78];
  const maxVal = 80;

  return (
    <div className="p-4 space-y-3">
      <div className="text-[10px] font-semibold text-gray-400">Revenue Growth</div>
      <div className="flex items-end gap-2 h-32">
        {months.map((month, i) => (
          <div key={month} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex gap-0.5 items-end" style={{ height: "100%" }}>
              <div
                className="flex-1 bg-gray-600 rounded-t-sm transition-all"
                style={{ height: `${(before[i] / maxVal) * 100}%` }}
              />
              <div
                className="flex-1 bg-brand-light rounded-t-sm transition-all"
                style={{ height: `${(after[i] / maxVal) * 100}%` }}
              />
            </div>
            <span className="text-[7px] text-gray-500">{month}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 pt-1">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-gray-600 rounded-sm" />
          <span className="text-[8px] text-gray-400">Before</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-brand-light rounded-sm" />
          <span className="text-[8px] text-gray-400">After EZBooker</span>
        </div>
      </div>
    </div>
  );
}

export function CtaBanner({ onOpenDemo }: FinalCtaProps) {
  return (
    <section className="py-24 bg-navy-dark text-white overflow-hidden relative">
      {/* Grid pattern background */}
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: "40px 40px",
        }}
      />

      <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-[2fr,1fr] gap-16 items-center relative z-10">
        {/* Left Column */}
        <div className="space-y-8">
          <h2 className="text-4xl md:text-6xl font-extrabold font-[family-name:var(--font-heading)] leading-tight tracking-tight">
            Ready to spend less time managing and more time growing?
          </h2>

          {/* Testimonial */}
          <div className="bg-navy/40 p-8 rounded-3xl border border-gray-800 flex flex-col sm:flex-row items-start gap-6 shadow-2xl">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-sm font-bold text-gray-300">
              AT
            </div>
            <blockquote className="space-y-4">
              <p className="text-lg sm:text-xl text-gray-100 leading-relaxed font-medium">
                &ldquo;Within 3 months of switching to EZBooker, our administrative
                team was handling twice as many bookings with 40% less overhead.
                The dynamic pricing alone covered our software costs in the first
                two weeks.&rdquo;
              </p>
              <footer className="text-brand-light font-bold text-lg">
                &mdash; David P., Owner, Ace Tennis Club
              </footer>
            </blockquote>
          </div>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pt-4">
            <button
              onClick={onOpenDemo}
              className="bg-white text-navy-dark px-10 py-4 rounded-full text-xl font-extrabold hover:bg-gray-100 transition-all transform hover:scale-[1.03] shadow-lg"
            >
              Schedule a Personalized Product Tour
            </button>
            <a
              href="#pricing"
              className="text-white font-semibold group flex items-center gap-2 text-lg"
            >
              See Pricing & Tiers
              <span className="group-hover:translate-x-1 transition-transform">
                &rarr;
              </span>
            </a>
          </div>
        </div>

        {/* Right Column: Case Study Visual */}
        <div className="relative">
          <div className="bg-navy p-2 rounded-2xl border border-gray-800 shadow-2xl">
            <CaseStudyChart />
          </div>
          <div className="absolute -bottom-4 -left-4 bg-brand px-5 py-2 rounded-full font-extrabold text-sm shadow-xl text-white">
            +35% Revenue
          </div>
        </div>
      </div>
    </section>
  );
}

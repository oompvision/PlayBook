"use client";

interface FinalCtaProps {
  onOpenDemo: () => void;
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

      <div className="max-w-7xl mx-auto px-6 relative z-10">
        {/* Left Column */}
        <div className="space-y-8">
          <h2 className="text-4xl md:text-6xl font-extrabold font-[family-name:var(--font-heading)] leading-tight tracking-tight">
            Ready to spend less time managing and more time growing?
          </h2>

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

      </div>
    </section>
  );
}

import { Button } from "@/components/ui/button";

interface HeroSectionProps {
  onOpenDemo: () => void;
  onOpenContact: () => void;
}

export function HeroSection({ onOpenDemo, onOpenContact }: HeroSectionProps) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-green-50 via-white to-emerald-50">
      {/* Subtle geometric pattern */}
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: `radial-gradient(circle at 1px 1px, #16a34a 1px, transparent 0)`,
        backgroundSize: "40px 40px",
      }} />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-24 md:py-32 lg:py-40">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="font-[family-name:var(--font-heading)] text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-gray-900">
            Run your facility.{" "}
            <span className="text-green-600">Not your software.</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-gray-600 leading-relaxed max-w-2xl mx-auto">
            EZBooker is the all-in-one booking platform built for modern athletic
            facilities — golf simulators, pickleball courts, tennis courts, batting
            cages, and more.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button
              size="lg"
              className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 text-base animate-subtle-pulse"
              onClick={onOpenDemo}
            >
              Book a Demo
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="px-8 py-3 text-base border-gray-300 text-gray-700 hover:bg-gray-50"
              onClick={onOpenContact}
            >
              Contact Us
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

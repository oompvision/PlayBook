import { Button } from "@/components/ui/button";
import { ScrollFadeIn } from "./scroll-fade-in";

interface CtaBannerProps {
  onOpenDemo: () => void;
}

export function CtaBanner({ onOpenDemo }: CtaBannerProps) {
  return (
    <section className="bg-gray-900 text-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 md:py-24">
        <ScrollFadeIn>
          <div className="text-center">
            <h2 className="font-[family-name:var(--font-heading)] text-3xl sm:text-4xl md:text-5xl font-bold">
              Ready to modernize your facility?
            </h2>
            <p className="mt-4 text-lg text-gray-400 max-w-2xl mx-auto">
              Join the waitlist or book a demo to see EZBooker in action.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button
                size="lg"
                className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 text-base"
                onClick={onOpenDemo}
              >
                Book a Demo
              </Button>
              <a href="mailto:hello@ezbooker.com">
                <Button
                  variant="outline"
                  size="lg"
                  className="px-8 py-3 text-base border-gray-600 text-white hover:bg-gray-800 hover:text-white"
                >
                  Contact Us
                </Button>
              </a>
            </div>
          </div>
        </ScrollFadeIn>
      </div>
    </section>
  );
}

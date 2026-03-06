import {
  UserPlus,
  Radio,
  Wallet,
  CalendarCheck,
  BadgeCheck,
  BellRing,
} from "lucide-react";
import { ScrollFadeIn } from "./scroll-fade-in";

const playerFeatures = [
  {
    icon: UserPlus,
    title: "Easy Sign Up & Booking",
    description:
      "Create an account and book a session in under a minute. Modify or cancel anytime.",
  },
  {
    icon: Radio,
    title: "Real-Time Availability",
    description:
      "Always know what's open. No back-and-forth, no confusion.",
  },
  {
    icon: Wallet,
    title: "Seamless Payments",
    description: "Fast, secure checkout every time.",
  },
  {
    icon: CalendarCheck,
    title: "Special Event Registration",
    description:
      "Browse and register for events directly through the platform.",
  },
  {
    icon: BadgeCheck,
    title: "Membership & Guest Passes",
    description:
      "Manage memberships and bring guests without any friction.",
  },
  {
    icon: BellRing,
    title: "Automated Reminders",
    description:
      "Booking confirmations and event reminders sent automatically.",
  },
];

export function ForPlayersSection() {
  return (
    <section id="for-players" className="py-20 md:py-28 bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <ScrollFadeIn>
          <div className="text-center mb-16">
            <p className="text-sm font-semibold uppercase tracking-wider text-green-600 mb-3">
              For Players
            </p>
            <h2 className="font-[family-name:var(--font-heading)] text-3xl sm:text-4xl md:text-5xl font-bold text-gray-900">
              Your players will{" "}
              <span className="text-green-600">love it too.</span>
            </h2>
            <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
              Give your customers the seamless booking experience they expect.
            </p>
          </div>
        </ScrollFadeIn>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {playerFeatures.map((feature, index) => (
            <ScrollFadeIn key={feature.title} delay={index * 80}>
              <div className="flex gap-4">
                <div className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-lg bg-green-50">
                  <feature.icon className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-gray-900">
                    {feature.title}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>
            </ScrollFadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

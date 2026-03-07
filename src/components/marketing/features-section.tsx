import {
  Settings,
  Zap,
  CalendarClock,
  CalendarHeart,
  CreditCard,
  RotateCcw,
  Users,
  Bell,
  MapPin,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ScrollFadeIn } from "./scroll-fade-in";

const features = [
  {
    icon: Settings,
    title: "Intuitive & Flexible Setup",
    description:
      "Get your facility live in minutes. Configure bays, courts, or lanes your way with zero technical complexity.",
  },
  {
    icon: Zap,
    title: "Dynamic Scheduling",
    description:
      "Automatically optimize availability to maximize facility usage and reduce dead time on the calendar.",
  },
  {
    icon: CalendarClock,
    title: "Slot-Based Scheduling",
    description:
      "Prefer manual control? Define exactly when bookings are available with full customization.",
  },
  {
    icon: CalendarHeart,
    title: "Integrated Event Hosting",
    description:
      "Run special events and open registrations seamlessly alongside your regular booking flow.",
  },
  {
    icon: CreditCard,
    title: "Fully Customizable Payments",
    description:
      "Charge upfront, hold a card, or collect payment at the facility. Your facility, your rules.",
  },
  {
    icon: RotateCcw,
    title: "Automated Cancellation & Refunds",
    description:
      "Set your cancellation policy once. EZBooker handles the rest — automatically.",
  },
  {
    icon: Users,
    title: "Membership Management",
    description:
      "Monthly or yearly dues, automated member perks, and guest access — all in one place.",
  },
  {
    icon: Bell,
    title: "Member Engagement Tools",
    description:
      "Automated reminders, at-will communications, and event announcements to keep your community engaged.",
  },
  {
    icon: MapPin,
    title: "Multi-Location Support",
    description:
      "Manage multiple locations from a single dashboard. Standard, not an upsell.",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="py-20 md:py-28 bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <ScrollFadeIn>
          <div className="text-center mb-16">
            <p className="text-sm font-semibold uppercase tracking-wider text-green-600 mb-3">
              For Facility Owners & Operators
            </p>
            <h2 className="font-[family-name:var(--font-heading)] text-3xl sm:text-4xl md:text-5xl font-bold text-gray-900">
              Everything you need to run a{" "}
              <span className="text-green-600">world-class facility.</span>
            </h2>
          </div>
        </ScrollFadeIn>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <ScrollFadeIn key={feature.title} delay={index * 80}>
              <Card className="h-full border border-gray-200 hover:-translate-y-1 hover:border-green-300 hover:shadow-lg transition-all duration-200 cursor-default">
                <CardHeader>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50 mb-3">
                    <feature.icon className="h-5 w-5 text-green-600" />
                  </div>
                  <CardTitle className="text-lg">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </CardContent>
              </Card>
            </ScrollFadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

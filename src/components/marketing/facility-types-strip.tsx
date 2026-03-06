import { Target, CircleDot, Trophy, Crosshair, MoreHorizontal } from "lucide-react";

const facilityTypes = [
  { icon: Target, label: "Golf Simulators" },
  { icon: CircleDot, label: "Pickleball" },
  { icon: Trophy, label: "Tennis" },
  { icon: Crosshair, label: "Batting Cages" },
  { icon: MoreHorizontal, label: "And More" },
];

export function FacilityTypesStrip() {
  return (
    <section className="bg-gray-50 border-y border-gray-100">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-12">
          {facilityTypes.map((type) => (
            <div
              key={type.label}
              className="flex items-center gap-2.5 text-gray-500"
            >
              <type.icon className="h-5 w-5" />
              <span className="text-sm font-medium">{type.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

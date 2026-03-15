"use client";

function PhoneMockup() {
  const slots = [
    { time: "9:00 AM", bay: "Court 1", available: true },
    { time: "10:00 AM", bay: "Court 1", available: true },
    { time: "10:00 AM", bay: "Court 2", available: true },
    { time: "11:00 AM", bay: "Sim 1", available: false },
    { time: "11:00 AM", bay: "Court 3", available: true },
    { time: "12:00 PM", bay: "Sim 2", available: true },
  ];

  return (
    <div className="w-[260px] mx-auto">
      {/* Phone frame */}
      <div className="bg-gray-900 rounded-[2.5rem] p-3 shadow-2xl">
        {/* Notch */}
        <div className="flex justify-center mb-2">
          <div className="w-24 h-5 bg-black rounded-full" />
        </div>
        {/* Screen */}
        <div className="bg-white rounded-[1.75rem] overflow-hidden">
          {/* Status bar */}
          <div className="flex items-center justify-between px-5 py-2 text-[8px] text-gray-500">
            <span>9:41</span>
            <div className="flex items-center gap-1">
              <div className="w-3 h-1.5 bg-gray-400 rounded-sm" />
              <div className="w-2.5 h-1.5 bg-gray-300 rounded-sm" />
              <div className="w-4 h-2 border border-gray-400 rounded-sm">
                <div className="w-2.5 h-full bg-brand rounded-sm" />
              </div>
            </div>
          </div>
          {/* App header */}
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="text-[10px] font-bold text-gray-900">Ace Tennis Club</div>
            <div className="text-[8px] text-gray-500 mt-0.5">Today &middot; Available Courts</div>
          </div>
          {/* Slot list */}
          <div className="p-3 space-y-2">
            {slots.map((slot, i) => (
              <div
                key={i}
                className={`flex items-center justify-between p-2.5 rounded-xl border ${
                  slot.available
                    ? "border-gray-100 bg-white"
                    : "border-gray-100 bg-gray-50 opacity-50"
                }`}
              >
                <div>
                  <div className="text-[9px] font-semibold text-gray-900">{slot.time}</div>
                  <div className="text-[8px] text-gray-500">{slot.bay}</div>
                </div>
                {slot.available ? (
                  <div className="bg-brand text-white text-[7px] font-bold px-2.5 py-1 rounded-full">
                    Book
                  </div>
                ) : (
                  <div className="text-[7px] text-gray-400 font-medium">Full</div>
                )}
              </div>
            ))}
          </div>
          {/* Bottom nav */}
          <div className="flex items-center justify-around py-3 border-t border-gray-100 mt-2">
            {["Home", "Book", "Profile"].map((tab) => (
              <div key={tab} className="flex flex-col items-center gap-0.5">
                <div className={`w-4 h-4 rounded-full ${tab === "Book" ? "bg-brand/20" : "bg-gray-100"}`} />
                <span className={`text-[7px] ${tab === "Book" ? "text-brand font-semibold" : "text-gray-400"}`}>{tab}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ForPlayersSection() {
  return (
    <section id="for-players" className="py-24 bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
        {/* Left: Persuasive text */}
        <div className="space-y-6">
          <div className="text-brand font-semibold text-sm tracking-widest uppercase">
            The Player Journey
          </div>
          <h2 className="text-4xl md:text-5xl font-extrabold text-gray-950 font-[family-name:var(--font-heading)] leading-tight">
            Your players will love it too.
          </h2>
          <p className="text-xl text-gray-700 max-w-lg leading-relaxed">
            The player-facing application is optimized for speed and simplicity. We
            ensure the process from discovery to checkout is seamless.
          </p>

          <ol className="space-y-6 pt-6 text-gray-900">
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center text-sm font-bold">
                1
              </span>
              <div>
                <strong className="block text-lg font-bold">
                  Find Availability in Seconds.
                </strong>
                <span className="text-gray-600">
                  Quickly search for specific court types, dates, and times.
                </span>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center text-sm font-bold">
                2
              </span>
              <div>
                <strong className="block text-lg font-bold">
                  Secure Booking in 3 Taps.
                </strong>
                <span className="text-gray-600">
                  Confirm reservations with an intuitive, modern calendar view.
                </span>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center text-sm font-bold">
                3
              </span>
              <div>
                <strong className="block text-lg font-bold">
                  Instant Confirmation & Payment.
                </strong>
                <span className="text-gray-600">
                  Integrated secure payments with immediate digital receipts.
                </span>
              </div>
            </li>
          </ol>
        </div>

        {/* Right: Phone Mockup */}
        <div className="relative justify-self-center group">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-brand-light/20 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition duration-1000" />
          <div className="relative">
            <PhoneMockup />
          </div>
        </div>
      </div>
    </section>
  );
}

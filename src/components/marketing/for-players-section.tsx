import Image from "next/image";

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

        {/* Right: iPhone 16 Pro Mockup */}
        <div className="relative justify-self-center group">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-brand-light/20 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition duration-1000" />

          <div className="relative w-[280px] sm:w-[300px]">
            {/* iPhone 16 Pro frame */}
            <div className="bg-[#1a1a1a] rounded-[3rem] p-[10px] shadow-2xl ring-1 ring-black/10">
              {/* Side buttons */}
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
                  alt="EZBooker mobile booking experience showing date selection, facility picker, duration options, and available time slots"
                  width={600}
                  height={1300}
                  className="w-full h-auto"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

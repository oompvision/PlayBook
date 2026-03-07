import Image from "next/image";
import Link from "next/link";

interface MarketingFooterProps {
  onOpenContact: () => void;
}

export function MarketingFooter({ onOpenContact }: MarketingFooterProps) {
  return (
    <footer className="bg-gray-50 border-t border-gray-200">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex flex-col items-center md:items-start gap-2">
            <Image
              src="/logos/ezbooker-logo-light.svg"
              alt="EZBooker"
              width={140}
              height={32}
            />
            <p className="text-sm text-muted-foreground">
              Run your facility. Not your software.
            </p>
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-gray-900 transition-colors">
              Features
            </a>
            <a href="#for-players" className="hover:text-gray-900 transition-colors">
              For Players
            </a>
            <a href="#pricing" className="hover:text-gray-900 transition-colors">
              Pricing
            </a>
            <button onClick={onOpenContact} className="hover:text-gray-900 transition-colors">
              Contact
            </button>
            <Link href="/auth/login" className="hover:text-gray-900 transition-colors">
              Admin Login
            </Link>
          </nav>
        </div>

        <div className="mt-8 pt-8 border-t border-gray-200 text-center">
          <p className="text-sm text-muted-foreground">
            &copy; 2025 EZBooker. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

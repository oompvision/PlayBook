"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface MarketingNavProps {
  onOpenDemo: () => void;
  onOpenContact: () => void;
  authInfo?: {
    role: string;
    orgId: string | null;
  } | null;
}

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "For Players", href: "#for-players" },
  { label: "Pricing", href: "#pricing" },
];

export function MarketingNav({ onOpenDemo, onOpenContact, authInfo }: MarketingNavProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const dashboardLink =
    authInfo?.role === "super_admin"
      ? "/super-admin"
      : authInfo?.role === "admin" && authInfo.orgId
        ? `/api/admin/enter/${authInfo.orgId}`
        : null;

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-all duration-300",
        scrolled
          ? "bg-white/95 backdrop-blur-sm border-b border-gray-100 shadow-sm"
          : "bg-white border-b border-gray-100"
      )}
    >
      <nav className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        {/* Left: Logo + Nav Links */}
        <div className="flex items-center gap-12">
          <Link href="/" className="flex-shrink-0">
            <Image
              src="/logos/ezbooker-logo-light.svg"
              alt="EZBooker"
              width={160}
              height={36}
              priority
            />
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-700">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="hover:text-brand transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>

        {/* Right: CTAs */}
        <div className="hidden md:flex items-center gap-3">
          <button
            onClick={onOpenContact}
            className="text-sm font-medium text-gray-700 hover:text-brand transition-colors"
          >
            Contact Us
          </button>
          <button
            onClick={onOpenDemo}
            className="bg-brand text-white px-5 py-2 rounded-full text-sm font-semibold hover:bg-brand-dark transition-colors"
          >
            Book a Demo
          </button>
          {dashboardLink ? (
            <a href={dashboardLink}>
              <span className="bg-gray-100 text-gray-900 px-5 py-2 rounded-full text-sm font-semibold hover:bg-gray-200 transition-colors inline-block">
                Dashboard
              </span>
            </a>
          ) : (
            <Link href="/auth/admin-login">
              <span className="bg-gray-100 text-gray-900 px-5 py-2 rounded-full text-sm font-semibold hover:bg-gray-200 transition-colors inline-block">
                Log In
              </span>
            </Link>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2 text-gray-600"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-100 bg-white/95 backdrop-blur-sm">
          <div className="px-6 py-4 space-y-3">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="block text-sm font-medium text-gray-700 hover:text-brand py-2 transition-colors"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <hr className="border-gray-100" />
            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => { setMobileOpen(false); onOpenContact(); }}
                className="w-full text-left text-sm font-medium text-gray-700 hover:text-brand py-2 transition-colors"
              >
                Contact Us
              </button>
              <button
                onClick={() => { setMobileOpen(false); onOpenDemo(); }}
                className="w-full bg-brand text-white px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-brand-dark transition-colors"
              >
                Book a Demo
              </button>
              {dashboardLink ? (
                <a href={dashboardLink} className="w-full">
                  <span className="block w-full text-center bg-gray-100 text-gray-900 px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-gray-200 transition-colors">
                    Dashboard
                  </span>
                </a>
              ) : (
                <Link href="/auth/admin-login" className="w-full">
                  <span className="block w-full text-center bg-gray-100 text-gray-900 px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-gray-200 transition-colors">
                    Log In
                  </span>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

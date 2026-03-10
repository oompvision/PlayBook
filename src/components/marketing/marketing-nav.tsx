"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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
    <nav
      className={cn(
        "sticky top-0 z-50 transition-all duration-300",
        scrolled
          ? "bg-white/95 backdrop-blur-sm border-b border-border shadow-sm"
          : "bg-transparent"
      )}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex-shrink-0">
            <Image
              src="/logos/ezbooker-logo-light.svg"
              alt="EZBooker"
              width={160}
              height={36}
              priority
            />
          </Link>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Desktop CTAs */}
          <div className="hidden md:flex items-center gap-3">
            <Button variant="ghost" size="sm" className="text-gray-600" onClick={onOpenContact}>
              Contact Us
            </Button>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={onOpenDemo}
            >
              Book a Demo
            </Button>
            {dashboardLink ? (
              <a href={dashboardLink}>
                <Button variant="outline" size="sm">
                  Dashboard
                </Button>
              </a>
            ) : (
              <Link href="/auth/admin-login">
                <Button variant="link" size="sm" className="text-gray-500 text-xs">
                  Admin Login
                </Button>
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
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t bg-white/95 backdrop-blur-sm">
          <div className="px-4 py-4 space-y-3">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="block text-sm font-medium text-gray-600 hover:text-gray-900 py-2"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <hr className="border-border" />
            <div className="flex flex-col gap-2 pt-2">
              <Button variant="outline" className="w-full" onClick={() => {
                  setMobileOpen(false);
                  onOpenContact();
                }}>
                Contact Us
              </Button>
              <Button
                className="w-full bg-green-600 hover:bg-green-700 text-white"
                onClick={() => {
                  setMobileOpen(false);
                  onOpenDemo();
                }}
              >
                Book a Demo
              </Button>
              {dashboardLink ? (
                <a href={dashboardLink}>
                  <Button variant="ghost" className="w-full">
                    Dashboard
                  </Button>
                </a>
              ) : (
                <Link href="/auth/admin-login">
                  <Button variant="ghost" className="w-full text-gray-500 text-sm">
                    Admin Login
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

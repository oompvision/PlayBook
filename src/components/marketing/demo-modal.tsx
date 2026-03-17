"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle, Loader2 } from "lucide-react";

interface DemoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DemoModal({ open, onOpenChange }: DemoModalProps) {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = e.currentTarget;
    const formData = new FormData(form);

    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "demo",
          name: formData.get("name"),
          email: formData.get("email"),
          facilityType: formData.get("facilityType"),
          locations: formData.get("locations"),
          message: formData.get("message"),
        }),
      });

      if (!res.ok) throw new Error("Failed to send");

      setSubmitted(true);
      setTimeout(() => {
        onOpenChange(false);
        setTimeout(() => setSubmitted(false), 300);
      }, 2000);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md border-brand/20 bg-brand-lightBg overflow-hidden">
        {/* Decorative green accent bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-brand-light via-brand to-brand-dark" />
        {submitted ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="rounded-full bg-brand/10 p-3">
              <CheckCircle className="h-12 w-12 text-brand" />
            </div>
            <DialogTitle className="text-xl font-semibold font-[family-name:var(--font-heading)] text-brand-dark">
              Thank you!
            </DialogTitle>
            <DialogDescription className="text-center text-brand-dark/70">
              We&apos;ll be in touch shortly to schedule your demo.
            </DialogDescription>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold font-[family-name:var(--font-heading)] text-brand-dark">
                Book a Demo
              </DialogTitle>
              <DialogDescription className="text-brand-dark/70">
                See EZBooker in action. Fill out the form and we&apos;ll schedule a personalized walkthrough.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="grid gap-4 pt-2">
              <div className="grid gap-2">
                <Label htmlFor="demo-name" className="text-brand-dark font-medium">Name</Label>
                <Input id="demo-name" name="name" placeholder="Your name" required className="border-brand/20 bg-white focus-visible:ring-brand/40 focus-visible:border-brand/40" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="demo-email" className="text-brand-dark font-medium">Email</Label>
                <Input id="demo-email" name="email" type="email" placeholder="you@example.com" required className="border-brand/20 bg-white focus-visible:ring-brand/40 focus-visible:border-brand/40" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="demo-facility-type" className="text-brand-dark font-medium">Facility Type</Label>
                <select
                  id="demo-facility-type"
                  name="facilityType"
                  required
                  className="flex h-9 w-full rounded-md border border-brand/20 bg-white px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 focus-visible:border-brand/40 md:text-sm"
                  defaultValue=""
                >
                  <option value="" disabled>Select a facility type</option>
                  <option value="Golf Simulators">Golf Simulators</option>
                  <option value="Pickleball Courts">Pickleball Courts</option>
                  <option value="Tennis Courts">Tennis Courts</option>
                  <option value="Batting Cages">Batting Cages</option>
                  <option value="Multi-Sport">Multi-Sport</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="demo-locations" className="text-brand-dark font-medium">Number of Locations</Label>
                <select
                  id="demo-locations"
                  name="locations"
                  required
                  className="flex h-9 w-full rounded-md border border-brand/20 bg-white px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 focus-visible:border-brand/40 md:text-sm"
                  defaultValue=""
                >
                  <option value="" disabled>Select number of locations</option>
                  <option value="1">1</option>
                  <option value="2-5">2 - 5</option>
                  <option value="6-10">6 - 10</option>
                  <option value="10+">10+</option>
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="demo-message" className="text-brand-dark font-medium">Message (optional)</Label>
                <textarea
                  id="demo-message"
                  name="message"
                  rows={3}
                  placeholder="Tell us about your facility..."
                  className="flex w-full rounded-md border border-brand/20 bg-white px-3 py-2 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 focus-visible:border-brand/40 md:text-sm resize-none"
                />
              </div>
              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}
              <Button
                type="submit"
                className="w-full bg-brand hover:bg-brand-dark text-white rounded-full font-semibold"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Request Demo"
                )}
              </Button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

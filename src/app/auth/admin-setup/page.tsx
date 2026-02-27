"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AdminSetupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [profileId, setProfileId] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [title, setTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    async function checkAuth() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/");
        return;
      }

      const { data: profile } = await supabase.rpc("get_my_profile");
      if (!profile || profile.role !== "admin") {
        router.replace("/");
        return;
      }

      // Check if already set up
      const { data: adminProfile } = await supabase
        .from("admin_profiles")
        .select("id")
        .eq("id", profile.id)
        .single();

      if (adminProfile) {
        // Already set up — go to dashboard
        window.location.href = "/admin";
        return;
      }

      setProfileId(profile.id);
      setFullName(profile.full_name || "");
      setLoading(false);
    }
    checkAuth();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setSubmitting(true);

    try {
      const supabase = createClient();

      // Set password
      const { error: pwError } = await supabase.auth.updateUser({
        password,
      });
      if (pwError) {
        setError(pwError.message);
        setSubmitting(false);
        return;
      }

      // Update profile name
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ full_name: fullName })
        .eq("id", profileId!);

      if (profileError) {
        setError(profileError.message);
        setSubmitting(false);
        return;
      }

      // Create admin profile
      const { error: adminError } = await supabase
        .from("admin_profiles")
        .insert({
          id: profileId!,
          title: title || null,
          phone: phone || null,
        });

      if (adminError) {
        setError(adminError.message);
        setSubmitting(false);
        return;
      }

      // Mark invitation as accepted
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.email) {
        await supabase
          .from("admin_invitations")
          .update({
            status: "accepted",
            accepted_at: new Date().toISOString(),
          })
          .eq("email", user.email)
          .eq("status", "pending");
      }

      // Full page navigation to pick up cookies
      window.location.href = "/admin";
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Complete Your Profile</CardTitle>
          <CardDescription>
            Set up your admin account to get started
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                type="text"
                placeholder="Jane Smith"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="title">Title (optional)</Label>
              <Input
                id="title"
                type="text"
                placeholder="e.g. General Manager"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone (optional)</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="(555) 123-4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Setting up..." : "Complete Setup"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

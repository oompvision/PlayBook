"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getClientFacilitySlug } from "@/lib/facility-client";
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

type Mode = "login" | "magic-link" | "forgot-password";

export function AdminLoginForm() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  function switchMode(newMode: Mode) {
    setMode(newMode);
    setError("");
    setMessage("");
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    // Check role
    const { data: profile } = await supabase.rpc("get_my_profile");

    if (!profile) {
      await supabase.auth.signOut();
      setError("Unable to load your profile. Please try again.");
      setLoading(false);
      return;
    }

    if (profile.role === "super_admin") {
      window.location.href = "/super-admin";
      return;
    }

    if (profile.role === "admin" && profile.org_id) {
      window.location.href = `/api/admin/enter/${profile.org_id}`;
      return;
    }

    if (profile.role === "admin" && !profile.org_id) {
      await supabase.auth.signOut();
      setError("Your account is not associated with an organization.");
      setLoading(false);
      return;
    }

    // Not an admin — sign out and show error
    await supabase.auth.signOut();
    setError("This login is for organization administrators.");
    setLoading(false);
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    const supabase = createClient();
    const slug = getClientFacilitySlug();
    const callbackUrl = new URL(`${window.location.origin}/auth/callback`);
    callbackUrl.searchParams.set("next", "/admin");
    if (slug) callbackUrl.searchParams.set("facility_slug", slug);

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: callbackUrl.toString(),
      },
    });

    if (otpError) {
      setError(otpError.message);
      setLoading(false);
      return;
    }

    setMessage("Check your email for a sign-in link.");
    setLoading(false);
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    const supabase = createClient();
    const resetSlug = getClientFacilitySlug();
    const resetUrl = new URL(`${window.location.origin}/auth/callback`);
    resetUrl.searchParams.set("next", "/auth/reset-password");
    if (resetSlug) resetUrl.searchParams.set("facility_slug", resetSlug);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: resetUrl.toString(),
      }
    );

    if (resetError) {
      setError(resetError.message);
      setLoading(false);
      return;
    }

    setMessage("Check your email for a password reset link.");
    setLoading(false);
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">
          {mode === "login" && "Admin Login"}
          {mode === "magic-link" && "Magic Link"}
          {mode === "forgot-password" && "Reset Password"}
        </CardTitle>
        <CardDescription>
          {mode === "login" && "Sign in to your organization dashboard"}
          {mode === "magic-link" && "We'll send a sign-in link to your email"}
          {mode === "forgot-password" &&
            "We'll send a password reset link to your email"}
        </CardDescription>
      </CardHeader>

      <form
        onSubmit={
          mode === "login"
            ? handleLogin
            : mode === "magic-link"
              ? handleMagicLink
              : handleForgotPassword
        }
      >
        <CardContent className="space-y-4">
          {message && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
              {message}
            </div>
          )}
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="admin-email">Email</Label>
            <Input
              id="admin-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          {mode === "login" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="admin-password">Password</Label>
                <button
                  type="button"
                  onClick={() => switchMode("forgot-password")}
                  className="text-xs text-primary hover:underline"
                >
                  Forgot password?
                </button>
              </div>
              <Input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading
              ? mode === "login"
                ? "Signing in..."
                : "Sending..."
              : mode === "login"
                ? "Sign In"
                : mode === "magic-link"
                  ? "Send Magic Link"
                  : "Send Reset Link"}
          </Button>

          {mode === "login" ? (
            <p className="text-sm text-muted-foreground">
              <button
                type="button"
                onClick={() => switchMode("magic-link")}
                className="font-medium text-primary hover:underline"
              >
                Sign in with magic link
              </button>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              <button
                type="button"
                onClick={() => switchMode("login")}
                className="font-medium text-primary hover:underline"
              >
                Back to login
              </button>
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            <Link
              href="/super-admin/auth/login"
              className="hover:underline"
            >
              Super Admin?
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}

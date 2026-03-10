"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
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

type Mode = "login" | "magic-link" | "forgot-password";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/";
  const isSuperAdmin = searchParams.get("role") === "super_admin";
  const urlMessage = searchParams.get("message");

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
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Full page navigation so middleware refreshes the session cookies
    // for server components to pick up
    window.location.href = redirectTo;
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    const supabase = createClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
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
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
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

  const title =
    isSuperAdmin
      ? "Super Admin Login"
      : mode === "login"
        ? "Sign In"
        : mode === "magic-link"
          ? "Magic Link"
          : "Reset Password";

  const description =
    isSuperAdmin
      ? "Sign in with your platform admin credentials"
      : mode === "login"
        ? "Enter your email and password to sign in"
        : mode === "magic-link"
          ? "We'll send a sign-in link to your email"
          : "We'll send a password reset link to your email";

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          {isSuperAdmin && (
            <div className="mb-2 flex justify-center">
              <img
                src="/logos/ezbooker-logo-light.svg"
                alt="EZ Booker"
                width={180}
                height={40}
              />
            </div>
          )}
          <CardTitle className="text-2xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
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
            {urlMessage && (
              <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                {urlMessage}
              </div>
            )}
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
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
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
                  <Label htmlFor="password">Password</Label>
                  <button
                    type="button"
                    onClick={() => switchMode("forgot-password")}
                    className="text-xs text-primary hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <Input
                  id="password"
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

            {!isSuperAdmin && mode === "login" && (
              <p className="text-sm text-muted-foreground">
                Don&apos;t have an account?{" "}
                <Link
                  href="/auth/signup"
                  className="font-medium text-primary hover:underline"
                >
                  Sign up
                </Link>
              </p>
            )}
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

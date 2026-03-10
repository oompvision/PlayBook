"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getClientFacilitySlug } from "@/lib/facility-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LogIn } from "lucide-react";

type AuthModalProps = {
  trigger?: React.ReactNode;
};

type SignInMode = "password" | "magic-link" | "forgot-password";

export function AuthModal({ trigger }: AuthModalProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<string>("signin");
  const [signInMode, setSignInMode] = useState<SignInMode>("password");

  // Sign-in state
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signInError, setSignInError] = useState("");
  const [signInMessage, setSignInMessage] = useState("");
  const [signInLoading, setSignInLoading] = useState(false);

  // Sign-up state
  const [signUpName, setSignUpName] = useState("");
  const [signUpPhone, setSignUpPhone] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [signUpError, setSignUpError] = useState("");
  const [signUpLoading, setSignUpLoading] = useState(false);
  const [signUpSuccess, setSignUpSuccess] = useState(false);

  function switchSignInMode(mode: SignInMode) {
    setSignInMode(mode);
    setSignInError("");
    setSignInMessage("");
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setSignInLoading(true);
    setSignInError("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: signInEmail,
      password: signInPassword,
    });

    if (error) {
      setSignInError(error.message);
      setSignInLoading(false);
      return;
    }

    // Full page reload so middleware refreshes session cookies
    window.location.reload();
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setSignInLoading(true);
    setSignInError("");
    setSignInMessage("");

    const supabase = createClient();
    const slug = getClientFacilitySlug();
    const callbackUrl = new URL(`${window.location.origin}/auth/callback`);
    if (slug) callbackUrl.searchParams.set("facility_slug", slug);

    const { error } = await supabase.auth.signInWithOtp({
      email: signInEmail,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: callbackUrl.toString(),
      },
    });

    if (error) {
      setSignInError(error.message);
      setSignInLoading(false);
      return;
    }

    setSignInMessage("Check your email for a sign-in link.");
    setSignInLoading(false);
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setSignInLoading(true);
    setSignInError("");
    setSignInMessage("");

    const supabase = createClient();
    const resetSlug = getClientFacilitySlug();
    const resetUrl = new URL(`${window.location.origin}/auth/callback`);
    resetUrl.searchParams.set("next", "/auth/reset-password");
    if (resetSlug) resetUrl.searchParams.set("facility_slug", resetSlug);

    const { error } = await supabase.auth.resetPasswordForEmail(signInEmail, {
      redirectTo: resetUrl.toString(),
    });

    if (error) {
      setSignInError(error.message);
      setSignInLoading(false);
      return;
    }

    setSignInMessage("Check your email for a password reset link.");
    setSignInLoading(false);
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setSignUpLoading(true);
    setSignUpError("");

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email: signUpEmail,
      password: signUpPassword,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          full_name: signUpName,
          phone: signUpPhone || undefined,
          facility_slug: getClientFacilitySlug() || undefined,
        },
      },
    });

    if (error) {
      setSignUpError(error.message);
      setSignUpLoading(false);
      return;
    }

    setSignUpSuccess(true);
    setSignUpLoading(false);
  }

  function resetState() {
    setSignInEmail("");
    setSignInPassword("");
    setSignInError("");
    setSignInMessage("");
    setSignInLoading(false);
    setSignInMode("password");
    setSignUpName("");
    setSignUpPhone("");
    setSignUpEmail("");
    setSignUpPassword("");
    setSignUpError("");
    setSignUpLoading(false);
    setSignUpSuccess(false);
    setTab("signin");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) resetState();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <LogIn className="mr-2 h-4 w-4" />
            Sign In
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Welcome</DialogTitle>
          <DialogDescription>
            Sign in to your account or create a new one to book sessions.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">Sign In</TabsTrigger>
            <TabsTrigger value="signup">Sign Up</TabsTrigger>
          </TabsList>

          {/* Sign In Tab */}
          <TabsContent value="signin">
            <form
              onSubmit={
                signInMode === "password"
                  ? handleSignIn
                  : signInMode === "magic-link"
                    ? handleMagicLink
                    : handleForgotPassword
              }
              className="space-y-4 pt-2"
            >
              {signInMessage && (
                <div className="rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
                  {signInMessage}
                </div>
              )}
              {signInError && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {signInError}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="signin-email">Email</Label>
                <Input
                  id="signin-email"
                  type="email"
                  placeholder="you@example.com"
                  value={signInEmail}
                  onChange={(e) => setSignInEmail(e.target.value)}
                  required
                />
              </div>
              {signInMode === "password" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="signin-password">Password</Label>
                    <button
                      type="button"
                      onClick={() => switchSignInMode("forgot-password")}
                      className="text-xs text-primary hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <Input
                    id="signin-password"
                    type="password"
                    value={signInPassword}
                    onChange={(e) => setSignInPassword(e.target.value)}
                    required
                  />
                </div>
              )}
              <Button type="submit" className="w-full" disabled={signInLoading}>
                {signInLoading
                  ? signInMode === "password"
                    ? "Signing in..."
                    : "Sending..."
                  : signInMode === "password"
                    ? "Sign In"
                    : signInMode === "magic-link"
                      ? "Send Magic Link"
                      : "Send Reset Link"}
              </Button>
              {signInMode === "password" ? (
                <p className="text-center text-sm text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => switchSignInMode("magic-link")}
                    className="font-medium text-primary hover:underline"
                  >
                    Sign in with magic link
                  </button>
                </p>
              ) : (
                <p className="text-center text-sm text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => switchSignInMode("password")}
                    className="font-medium text-primary hover:underline"
                  >
                    Back to password login
                  </button>
                </p>
              )}
            </form>
          </TabsContent>

          {/* Sign Up Tab */}
          <TabsContent value="signup">
            {signUpSuccess ? (
              <div className="space-y-3 pt-2">
                <div className="rounded-md bg-muted p-4 text-center">
                  <p className="font-medium">Check your email</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    We sent a confirmation link to{" "}
                    <span className="font-medium">{signUpEmail}</span>. Click
                    the link to activate your account, then sign in.
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setSignUpSuccess(false);
                    setTab("signin");
                    setSignInEmail(signUpEmail);
                  }}
                >
                  Go to Sign In
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSignUp} className="space-y-4 pt-2">
                {signUpError && (
                  <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                    {signUpError}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="signup-name">Full Name</Label>
                  <Input
                    id="signup-name"
                    type="text"
                    placeholder="John Doe"
                    value={signUpName}
                    onChange={(e) => setSignUpName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-phone">
                    Phone Number{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="signup-phone"
                    type="tel"
                    placeholder="(555) 123-4567"
                    value={signUpPhone}
                    onChange={(e) => setSignUpPhone(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="you@example.com"
                    value={signUpEmail}
                    onChange={(e) => setSignUpEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="At least 6 characters"
                    value={signUpPassword}
                    onChange={(e) => setSignUpPassword(e.target.value)}
                    minLength={6}
                    required
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={signUpLoading}
                >
                  {signUpLoading ? "Creating account..." : "Create Account"}
                </Button>
              </form>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

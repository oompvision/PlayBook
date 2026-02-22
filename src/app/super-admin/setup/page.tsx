"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function SuperAdminSetupPage() {
  const [status, setStatus] = useState<
    "checking" | "needs_login" | "ready" | "claiming" | "success" | "already_exists" | "error"
  >("checking");
  const [email, setEmail] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    async function check() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setStatus("needs_login");
        return;
      }

      setEmail(user.email || "");
      setStatus("ready");
    }
    check();
  }, []);

  async function handleClaim() {
    setStatus("claiming");
    setErrorMsg("");

    const supabase = createClient();
    const { data, error } = await supabase.rpc("claim_super_admin");

    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
      return;
    }

    if (data === true) {
      setStatus("success");
      // Redirect to super admin dashboard after a short delay
      setTimeout(() => {
        window.location.href = "/super-admin";
      }, 1500);
    } else {
      setStatus("already_exists");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">PlayBook Setup</CardTitle>
          <CardDescription>
            First-time platform setup — claim the Super Admin role
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status === "checking" && (
            <p className="text-center text-sm text-muted-foreground">
              Checking authentication...
            </p>
          )}

          {status === "needs_login" && (
            <div className="space-y-3 text-center">
              <p className="text-sm text-muted-foreground">
                You need to sign in first before claiming the Super Admin role.
              </p>
              <Button
                className="w-full"
                onClick={() => {
                  window.location.href =
                    "/auth/login?redirect=/super-admin/setup&role=super_admin";
                }}
              >
                Sign In
              </Button>
            </div>
          )}

          {status === "ready" && (
            <div className="space-y-3 text-center">
              <p className="text-sm text-muted-foreground">
                Signed in as <strong>{email}</strong>
              </p>
              <p className="text-sm text-muted-foreground">
                This will make your account the platform Super Admin. This can
                only be done once.
              </p>
            </div>
          )}

          {status === "claiming" && (
            <p className="text-center text-sm text-muted-foreground">
              Setting up Super Admin...
            </p>
          )}

          {status === "success" && (
            <div className="rounded-md bg-green-50 p-3 text-center text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
              Super Admin role claimed! Redirecting to dashboard...
            </div>
          )}

          {status === "already_exists" && (
            <div className="rounded-md bg-yellow-50 p-3 text-center text-sm text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300">
              A Super Admin already exists. Contact them for access.
            </div>
          )}

          {status === "error" && (
            <div className="space-y-2">
              <div className="rounded-md bg-destructive/10 p-3 text-center text-sm text-destructive">
                {errorMsg}
              </div>
              <p className="text-center text-xs text-muted-foreground">
                Make sure you&apos;ve run migration 00012 in Supabase SQL Editor.
              </p>
            </div>
          )}
        </CardContent>
        {status === "ready" && (
          <CardFooter>
            <Button className="w-full" onClick={handleClaim}>
              Claim Super Admin Role
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}

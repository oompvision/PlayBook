"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function SignOutButton({
  variant = "ghost",
  size = "sm",
  className = "mt-2 w-full justify-start px-0 text-muted-foreground hover:text-foreground",
}: {
  variant?: "ghost" | "outline" | "default" | "secondary" | "destructive" | "link";
  size?: "sm" | "default" | "lg" | "icon";
  className?: string;
} = {}) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={handleSignOut}
    >
      Sign Out
    </Button>
  );
}

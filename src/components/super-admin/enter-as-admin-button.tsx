"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { enterAsAdmin } from "@/app/super-admin/(dashboard)/orgs/[id]/actions";

export function EnterAsAdminButton({ orgId }: { orgId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={isPending}
      onClick={() => startTransition(() => enterAsAdmin(orgId))}
    >
      {isPending ? "Entering..." : "Enter as Admin"}
    </Button>
  );
}

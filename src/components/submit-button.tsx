"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { type ComponentProps } from "react";

export function SubmitButton({
  children,
  pendingText,
  ...props
}: ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? (pendingText ?? "Working...") : children}
    </Button>
  );
}

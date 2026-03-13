"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Toast } from "@/components/ui/toast";

/**
 * Client component that detects ?saved=true in the URL,
 * shows a Toast notification, and cleans up the URL param.
 * Drop this into any server-component page that redirects with ?saved=true.
 */
export function SavedToast({
  message = "Changes saved successfully.",
  param = "saved",
}: {
  message?: string;
  param?: string;
}) {
  const [show, setShow] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (searchParams.get(param) === "true") {
      setShow(true);
      const url = new URL(window.location.href);
      url.searchParams.delete(param);
      url.searchParams.delete("error");
      router.replace(url.pathname + url.search, { scroll: false });
    }
  }, [searchParams, param, router]);

  if (!show) return null;
  return <Toast message={message} duration={5000} onClose={() => setShow(false)} />;
}

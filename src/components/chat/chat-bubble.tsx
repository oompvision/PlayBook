"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChatWidget } from "./chat-widget";
import { MessageSquare, X } from "lucide-react";

type ChatBubbleProps = {
  facilitySlug: string;
  orgName: string;
};

// Pages where the floating bubble should NOT appear at all
const HIDDEN_PATHS = ["/admin", "/super-admin"];

export function ChatBubble({ facilitySlug, orgName }: ChatBubbleProps) {
  const pathname = usePathname();
  const isHomepage = pathname === "/";

  // Default to open on homepage (for desktop), closed on other pages
  const [isOpen, setIsOpen] = useState(isHomepage);
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  // Hide on admin and super-admin pages
  const shouldHide = HIDDEN_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  if (shouldHide) return null;

  // Avoid flash before hydration when using conditional default state
  if (!hasMounted) return null;

  // On homepage: only show on desktop (lg+) since mobile has its own inline ChatWidget
  // On other pages: show on all screen sizes
  const visibilityClass = isHomepage ? "hidden lg:block" : "";

  return (
    <div className={`fixed bottom-4 right-4 z-50 ${visibilityClass}`}>
      {/* Chat panel */}
      {isOpen && (
        <div className="mb-3 flex h-[500px] w-[380px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border bg-card shadow-2xl">
          {/* Close button in the header area */}
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="text-sm font-medium">Chat</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setIsOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <ChatWidget
              facilitySlug={facilitySlug}
              orgName={orgName}
            />
          </div>
        </div>
      )}

      {/* Floating action button */}
      <div className="flex justify-end">
        <Button
          size="icon"
          className="h-14 w-14 rounded-full shadow-lg"
          onClick={() => setIsOpen((prev) => !prev)}
        >
          {isOpen ? (
            <X className="h-6 w-6" />
          ) : (
            <MessageSquare className="h-6 w-6" />
          )}
        </Button>
      </div>
    </div>
  );
}

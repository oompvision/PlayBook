"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, CheckCircle } from "lucide-react";

type ToastProps = {
  message: string;
  description?: string;
  duration?: number;
  onClose: () => void;
};

export function Toast({ message, description, duration = 10000, onClose }: ToastProps) {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Trigger enter animation
    requestAnimationFrame(() => setVisible(true));

    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 300); // Wait for exit animation
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed bottom-6 right-6 z-[100] max-w-sm rounded-lg border bg-background p-4 shadow-lg transition-all duration-300 ${
        visible
          ? "translate-y-0 opacity-100"
          : "translate-y-4 opacity-0"
      }`}
    >
      <div className="flex items-start gap-3">
        <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
        <div className="flex-1">
          <p className="text-sm font-semibold">{message}</p>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setVisible(false);
            setTimeout(onClose, 300);
          }}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>,
    document.body
  );
}

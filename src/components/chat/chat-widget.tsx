"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChatMessage, TypingIndicator, type Message } from "./chat-message";
import { SendHorizontal, MessageSquare } from "lucide-react";

const QUICK_REPLIES_DELIMITER = "\n\n<<QUICK_REPLIES>>\n";
const BOOKING_ACTION_DELIMITER = "\n\n<<BOOKING_ACTION>>\n";

export type BookingAction = {
  date: string;
  bay_name: string;
  start_time: string;
  slot_ids?: string[];
};

type ChatWidgetProps = {
  facilitySlug: string;
  orgName: string;
  /** "sidebar" = narrow sidebar embed, "inline" = full-width mobile embed, "panel" = floating popup */
  mode?: "sidebar" | "inline" | "panel";
  /** Callback when the AI triggers a booking checkout action */
  onBookingAction?: (action: BookingAction) => void;
};

export function ChatWidget({
  facilitySlug,
  orgName,
  mode = "panel",
  onBookingAction,
}: ChatWidgetProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  const sendMessage = useCallback(
    async (text: string, currentMessages: Message[]) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const userMessage: Message = { role: "user", content: trimmed };
      const updatedMessages = [...currentMessages, userMessage];
      setMessages(updatedMessages);
      setInput("");
      setIsLoading(true);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            facilitySlug,
            // Strip quickReplies from messages sent to the API
            messages: updatedMessages.map(({ role, content }) => ({
              role,
              content,
            })),
          }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => null);
          throw new Error(err?.error ?? "Failed to get response");
        }

        // Read streamed response
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let assistantText = "";

        // Add an empty assistant message that we'll update progressively
        setMessages((prev) => [...prev, { role: "model", content: "" }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          assistantText += decoder.decode(value, { stream: true });
          // Strip action delimiters from display during streaming
          const displayText = assistantText
            .split(BOOKING_ACTION_DELIMITER)[0]
            .split(QUICK_REPLIES_DELIMITER)[0];
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: "model",
              content: displayText,
            };
            return updated;
          });
        }

        // Parse booking action from the final text
        let cleanedText = assistantText;
        if (cleanedText.includes(BOOKING_ACTION_DELIMITER)) {
          const delimIndex = cleanedText.indexOf(BOOKING_ACTION_DELIMITER);
          const afterDelim = cleanedText.slice(delimIndex + BOOKING_ACTION_DELIMITER.length);
          cleanedText = cleanedText.slice(0, delimIndex);
          // The booking action JSON may be followed by quick replies
          const actionJson = afterDelim.split(QUICK_REPLIES_DELIMITER)[0];
          try {
            const action = JSON.parse(actionJson) as BookingAction;
            onBookingAction?.(action);
          } catch {
            // JSON parse failed — ignore
          }
          // Re-attach quick replies portion if present
          if (afterDelim.includes(QUICK_REPLIES_DELIMITER)) {
            const qrIndex = afterDelim.indexOf(QUICK_REPLIES_DELIMITER);
            cleanedText += afterDelim.slice(qrIndex);
          }
        }

        // Parse quick replies from the final text
        if (cleanedText.includes(QUICK_REPLIES_DELIMITER)) {
          const delimIndex = cleanedText.indexOf(QUICK_REPLIES_DELIMITER);
          const displayText = cleanedText.slice(0, delimIndex);
          const repliesJson = cleanedText.slice(
            delimIndex + QUICK_REPLIES_DELIMITER.length
          );
          try {
            const quickReplies = JSON.parse(repliesJson);
            if (Array.isArray(quickReplies)) {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "model",
                  content: displayText,
                  quickReplies,
                };
                return updated;
              });
            }
          } catch {
            // JSON parse failed — just show the text without buttons
          }
        } else if (cleanedText !== assistantText) {
          // Booking action was stripped — update display with clean text
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: "model",
              content: cleanedText,
            };
            return updated;
          });
        } else if (!cleanedText.trim()) {
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: "model",
              content:
                "I'm sorry, I couldn't generate a response. Please try again.",
            };
            return updated;
          });
        }
      } catch (error) {
        setMessages((prev) => [
          ...prev.filter((m) => m.content !== ""),
          {
            role: "model",
            content:
              error instanceof Error
                ? error.message
                : "Something went wrong. Please try again.",
          },
        ]);
      } finally {
        setIsLoading(false);
        inputRef.current?.focus();
      }
    },
    [facilitySlug, onBookingAction]
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isLoading) return;
    sendMessage(input, messages);
  }

  function handleQuickReply(text: string) {
    if (isLoading) return;
    sendMessage(text, messages);
  }

  const isSidebar = mode === "sidebar";
  const isPanel = mode === "panel";

  const suggestions = isSidebar
    ? ["Open today?", "Prices?", "My bookings"]
    : ["Any slots open today?", "Show my bookings", "What are your prices?"];

  return (
    <div className={`flex flex-col gap-2 ${isPanel || isSidebar ? "h-full" : ""} ${isPanel ? "p-3" : ""}`}>
      {/* Messages area */}
      <div
        className={`flex flex-col gap-2 overflow-y-auto rounded-lg border bg-background p-2.5 ${
          isPanel || isSidebar
            ? "min-h-0 flex-1"
            : "max-h-80 min-h-40"
        }`}
      >
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-4 text-center">
            <MessageSquare className="h-6 w-6 text-muted-foreground/30" />
            <p className={`text-muted-foreground ${isSidebar ? "text-xs" : "text-sm"}`}>
              {isSidebar
                ? `Ask about ${orgName}`
                : `Hi! Ask me about availability at ${orgName}.`}
            </p>
            <div className="mt-1 flex flex-wrap justify-center gap-1">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className={`rounded-full border px-2.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${
                    isSidebar ? "text-[11px]" : "text-xs"
                  }`}
                  onClick={() => handleQuickReply(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage
            key={i}
            message={msg}
            compact={isSidebar}
            onQuickReply={
              i === messages.length - 1 &&
              msg.role === "model" &&
              !isLoading
                ? handleQuickReply
                : undefined
            }
          />
        ))}
        {isLoading && messages[messages.length - 1]?.role !== "model" && (
          <TypingIndicator />
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-1.5">
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isSidebar ? "Ask anything..." : "Ask about availability..."}
          disabled={isLoading}
          className={`flex-1 ${isSidebar ? "h-8 text-xs" : ""}`}
        />
        <Button
          type="submit"
          size="icon"
          disabled={isLoading || !input.trim()}
          className={isSidebar ? "h-8 w-8" : ""}
        >
          <SendHorizontal className={isSidebar ? "h-3.5 w-3.5" : "h-4 w-4"} />
        </Button>
      </form>
    </div>
  );
}

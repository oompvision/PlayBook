"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChatMessage, TypingIndicator, type Message } from "./chat-message";
import { SendHorizontal, MessageSquare } from "lucide-react";

const QUICK_REPLIES_DELIMITER = "\n\n<<QUICK_REPLIES>>\n";

type ChatWidgetProps = {
  facilitySlug: string;
  orgName: string;
  inline?: boolean;
};

export function ChatWidget({
  facilitySlug,
  orgName,
  inline = false,
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
          // Strip quick replies delimiter from display during streaming
          const displayText = assistantText.split(QUICK_REPLIES_DELIMITER)[0];
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: "model",
              content: displayText,
            };
            return updated;
          });
        }

        // Parse quick replies from the final text
        if (assistantText.includes(QUICK_REPLIES_DELIMITER)) {
          const delimIndex = assistantText.indexOf(QUICK_REPLIES_DELIMITER);
          const displayText = assistantText.slice(0, delimIndex);
          const repliesJson = assistantText.slice(
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
        } else if (!assistantText.trim()) {
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
    [facilitySlug]
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

  const containerClass = inline
    ? "w-full"
    : "flex h-full flex-col";

  return (
    <Card className={containerClass}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4" />
          Availability Assistant
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Ask about available times, facilities, or pricing
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {/* Messages area */}
        <div
          className={
            inline
              ? "flex max-h-80 min-h-40 flex-col gap-2.5 overflow-y-auto rounded-lg border bg-background p-3"
              : "flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto rounded-lg border bg-background p-3"
          }
        >
          {messages.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
              <MessageSquare className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                Hi! Ask me about availability at {orgName}.
              </p>
              <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                {[
                  "Any slots open today?",
                  "Show my bookings",
                  "What are your prices?",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about availability..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button
            type="submit"
            size="icon"
            disabled={isLoading || !input.trim()}
          >
            <SendHorizontal className="h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

"use client";

import { cn } from "@/lib/utils";

export type Message = {
  role: "user" | "model";
  content: string;
};

export function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-muted text-foreground rounded-bl-md"
        )}
      >
        {message.content.split("\n").map((line, i) => (
          <span key={i}>
            {line}
            {i < message.content.split("\n").length - 1 && <br />}
          </span>
        ))}
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
        <div className="flex gap-1.5">
          <span className="bg-muted-foreground/40 h-2 w-2 animate-bounce rounded-full [animation-delay:0ms]" />
          <span className="bg-muted-foreground/40 h-2 w-2 animate-bounce rounded-full [animation-delay:150ms]" />
          <span className="bg-muted-foreground/40 h-2 w-2 animate-bounce rounded-full [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

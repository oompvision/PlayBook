"use client";

import { cn } from "@/lib/utils";

export type Message = {
  role: "user" | "model";
  content: string;
  quickReplies?: string[];
  bookingLink?: string;
};

type ChatMessageProps = {
  message: Message;
  compact?: boolean;
  onQuickReply?: (text: string) => void;
};

/** Render inline markdown: **bold** and *italic* */
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Match **bold** or *italic* (non-greedy)
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Text before this match
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      // **bold**
      nodes.push(<strong key={match.index}>{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      // *italic*
      nodes.push(<em key={match.index}>{match[2]}</em>);
    }
    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

export function ChatMessage({ message, compact, onQuickReply }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex w-full flex-col", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[90%] rounded-2xl leading-relaxed",
          compact ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-muted text-foreground rounded-bl-md"
        )}
      >
        {message.content.split("\n").map((line, i) => (
          <span key={i}>
            {renderInlineMarkdown(line)}
            {i < message.content.split("\n").length - 1 && <br />}
          </span>
        ))}
      </div>
      {(message.bookingLink || (onQuickReply && message.quickReplies && message.quickReplies.length > 0)) && (
        <div className="mt-1 flex flex-wrap gap-1">
          {message.bookingLink && (
            <a
              href={message.bookingLink}
              className={cn(
                "rounded-full border border-green-600/30 bg-green-600 font-medium text-white transition-colors hover:bg-green-700 inline-block",
                compact ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs"
              )}
            >
              Go to Confirmation
            </a>
          )}
          {onQuickReply && message.quickReplies?.map((reply) => (
            <button
              key={reply}
              type="button"
              className={cn(
                "rounded-full border border-primary/30 bg-primary/5 font-medium text-primary transition-colors hover:bg-primary/15 active:bg-primary/25",
                compact ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs"
              )}
              onClick={() => onQuickReply(reply)}
            >
              {reply}
            </button>
          ))}
        </div>
      )}
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

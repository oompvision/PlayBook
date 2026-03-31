/**
 * Structured logger for SOC II compliance.
 * Replaces raw console.log/error/warn calls with PII-safe structured output.
 */

const PII_PATTERNS: [RegExp, string][] = [
  // Email addresses
  [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL_REDACTED]"],
  // Phone numbers (various formats)
  [/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "[PHONE_REDACTED]"],
  // Authorization headers / tokens
  [/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, "[TOKEN_REDACTED]"],
  // Stripe secret keys
  [/sk_(test|live)_[A-Za-z0-9]+/g, "[STRIPE_KEY_REDACTED]"],
  // Supabase service role keys
  [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[JWT_REDACTED]"],
];

/** Fields to completely remove from logged objects */
const SENSITIVE_FIELDS = new Set([
  "password",
  "guest_email",
  "guest_phone",
  "guest_name",
  "ip_address",
  "authorization",
  "cookie",
  "set-cookie",
  "x-supabase-auth",
]);

function sanitizeString(str: string): string {
  let result = str;
  for (const [pattern, replacement] of PII_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[TRUNCATED]";

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = sanitizeValue(val, depth + 1);
      }
    }
    return sanitized;
  }

  return value;
}

type LogLevel = "info" | "warn" | "error";

function formatLog(level: LogLevel, message: string, context?: unknown) {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message: sanitizeString(message),
  };

  if (context !== undefined) {
    if (context instanceof Error) {
      entry.error = {
        name: context.name,
        message: sanitizeString(context.message),
        // Only include stack in development
        ...(process.env.NODE_ENV !== "production" && { stack: context.stack }),
      };
    } else {
      entry.context = sanitizeValue(context);
    }
  }

  return JSON.stringify(entry);
}

export const logger = {
  info(message: string, context?: unknown) {
    console.log(formatLog("info", message, context));
  },
  warn(message: string, context?: unknown) {
    console.warn(formatLog("warn", message, context));
  },
  error(message: string, context?: unknown) {
    console.error(formatLog("error", message, context));
  },
};

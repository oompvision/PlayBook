/**
 * PII sanitizer for SOC II compliance.
 * Masks personally identifiable information before sending data to
 * third-party services (e.g. Google Gemini AI).
 */

/** Fields whose values should be completely removed */
const REMOVE_FIELDS = new Set([
  "guest_email",
  "guest_phone",
  "ip_address",
  "user_agent",
]);

/** Fields whose values should be masked */
const MASK_FIELDS = new Set([
  "email",
  "phone",
  "full_name",
  "customer_email",
  "customer_name",
  "guest_name",
  "recipient_email",
  "recipient_name",
]);

function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) return "***@***.***";
  const local = email.substring(0, atIndex);
  const domain = email.substring(atIndex);
  return `${local[0]}***${domain}`;
}

function maskPhone(phone: string): string {
  // Keep last 4 digits
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***-***-${digits.slice(-4)}`;
}

function maskName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "***";
  if (parts.length === 1) return `${parts[0][0]}.`;
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

function maskFieldValue(key: string, value: string): string {
  const lowerKey = key.toLowerCase();
  if (lowerKey.includes("email")) return maskEmail(value);
  if (lowerKey.includes("phone")) return maskPhone(value);
  if (lowerKey.includes("name")) return maskName(value);
  return "***";
}

/**
 * Recursively sanitize PII from a data structure.
 * Designed to be applied to tool execution results before sending to AI.
 */
export function sanitizePII(data: unknown, depth = 0): unknown {
  if (depth > 10) return data;

  if (typeof data === "string") {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizePII(item, depth + 1));
  }

  if (data !== null && typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (REMOVE_FIELDS.has(key)) {
        continue; // Remove the field entirely
      }

      if (MASK_FIELDS.has(key) && typeof value === "string") {
        result[key] = maskFieldValue(key, value);
      } else {
        result[key] = sanitizePII(value, depth + 1);
      }
    }
    return result;
  }

  return data;
}

/**
 * Sanitize a tool result object before sending to Gemini.
 * Wraps sanitizePII with type assertion for API convenience.
 */
export function sanitizeForAI<T>(toolResult: T): T {
  return sanitizePII(toolResult) as T;
}

/**
 * Password policy enforcement for SOC II compliance.
 * Requires: 8+ chars, uppercase, lowercase, digit, special character.
 */

interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push("At least 8 characters");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("At least one uppercase letter");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("At least one lowercase letter");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("At least one number");
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push("At least one special character");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Returns password strength as a simple label for UI indicators.
 */
export function getPasswordStrength(password: string): "weak" | "fair" | "strong" {
  if (password.length === 0) return "weak";

  const { errors } = validatePassword(password);
  if (errors.length === 0 && password.length >= 12) return "strong";
  if (errors.length <= 1) return "fair";
  return "weak";
}

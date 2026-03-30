/**
 * Request body validation helper for API routes.
 * Provides consistent Zod-based validation with safe error responses.
 */

import { NextResponse } from "next/server";
import type { ZodType } from "zod/v4";

type ValidationSuccess<T> = { data: T; error?: never };
type ValidationError = { data?: never; error: NextResponse };
type ValidationResult<T> = ValidationSuccess<T> | ValidationError;

/**
 * Parse and validate a JSON request body against a Zod schema.
 * Returns { data } on success or { error: NextResponse } on failure.
 */
export async function validateBody<T>(
  request: Request,
  schema: ZodType<T>
): Promise<ValidationResult<T>> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return {
      error: NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      ),
    };
  }

  const result = schema.safeParse(body);

  if (!result.success) {
    return {
      error: NextResponse.json(
        { error: "Invalid request data" },
        { status: 400 }
      ),
    };
  }

  return { data: result.data };
}

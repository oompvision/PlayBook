import { z } from "zod/v4";

export const bookingNotificationSchema = z.object({
  action: z.enum(["confirmed", "canceled", "modified"]),
  bookingId: z.string().uuid().optional(),
  confirmationCode: z.string().optional(),
  orgId: z.string().uuid(),
  oldConfirmationCode: z.string().optional(),
});

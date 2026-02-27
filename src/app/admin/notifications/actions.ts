"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function markAsRead(notificationId: string) {
  const auth = await getAuthUser();
  if (!auth) return;

  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", notificationId)
    .eq("recipient_id", auth.user.id);

  revalidatePath("/admin/notifications");
}

export async function markAllAsRead() {
  const auth = await getAuthUser();
  if (!auth) return;

  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("recipient_id", auth.user.id)
    .eq("is_read", false);

  revalidatePath("/admin/notifications");
}

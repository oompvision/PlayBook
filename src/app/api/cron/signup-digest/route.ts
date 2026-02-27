import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyOrgAdmins } from "@/lib/notifications";

/**
 * Batched signup digest — runs daily via Vercel Cron at 7:00 AM UTC.
 * Groups pending signups by org and sends a single summary notification
 * to each org's admin(s).
 */
export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Get all unbatched signups grouped by org
  const { data: pending } = await supabase
    .from("pending_signup_notifications")
    .select("id, org_id, customer_email, customer_name")
    .is("batched_at", null)
    .order("created_at", { ascending: true });

  if (!pending || pending.length === 0) {
    return NextResponse.json({ message: "No pending signups", processed: 0 });
  }

  // Group by org_id
  const byOrg = new Map<
    string,
    Array<{ id: string; customer_email: string; customer_name: string | null }>
  >();
  for (const row of pending) {
    const list = byOrg.get(row.org_id) ?? [];
    list.push({
      id: row.id,
      customer_email: row.customer_email,
      customer_name: row.customer_name,
    });
    byOrg.set(row.org_id, list);
  }

  let processedCount = 0;

  for (const [orgId, signups] of byOrg) {
    // Get org name
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .single();

    const orgName = org?.name ?? "Your facility";
    const count = signups.length;
    const nameList = signups
      .map((s) => s.customer_name || s.customer_email)
      .slice(0, 5)
      .join(", ");
    const suffix = count > 5 ? ` and ${count - 5} more` : "";

    await notifyOrgAdmins(orgId, orgName, {
      type: "new_customer_signup",
      title: `${count} new customer${count === 1 ? "" : "s"} signed up`,
      message: `${nameList}${suffix}`,
      link: "/admin/customers",
    });

    // Mark as batched
    const ids = signups.map((s) => s.id);
    await supabase
      .from("pending_signup_notifications")
      .update({ batched_at: new Date().toISOString() })
      .in("id", ids);

    processedCount += count;
  }

  return NextResponse.json({
    message: "Signup digest processed",
    orgs: byOrg.size,
    processed: processedCount,
  });
}

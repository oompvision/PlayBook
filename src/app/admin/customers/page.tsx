import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .eq("slug", slug)
    .single();
  return data;
}

export default async function CustomerListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();

  let query = supabase
    .from("profiles")
    .select("id, email, full_name, phone, role, created_at")
    .eq("org_id", org.id)
    .eq("role", "customer")
    .order("created_at", { ascending: false });

  const search = params.q?.trim();
  if (search) {
    query = query.or(
      `full_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`
    );
  }

  const { data: customers } = await query;

  // Get booking counts per customer
  const customerIds = customers?.map((c) => c.id) ?? [];
  let bookingCounts: Record<string, number> = {};
  if (customerIds.length > 0) {
    const { data: counts } = await supabase
      .from("bookings")
      .select("customer_id")
      .eq("org_id", org.id)
      .in("customer_id", customerIds);

    if (counts) {
      for (const row of counts) {
        bookingCounts[row.customer_id] =
          (bookingCounts[row.customer_id] || 0) + 1;
      }
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
          <p className="mt-2 text-muted-foreground">
            View and search registered customers.
          </p>
        </div>
        <Badge variant="secondary">{customers?.length ?? 0} total</Badge>
      </div>

      {/* Search */}
      <form className="mt-6">
        <div className="flex gap-2">
          <Input
            name="q"
            placeholder="Search by name, email, or phone..."
            defaultValue={search ?? ""}
            className="max-w-sm"
          />
          <Button type="submit" variant="outline" size="sm">
            Search
          </Button>
          {search && (
            <a href="/admin/customers">
              <Button type="button" variant="ghost" size="sm">
                Clear
              </Button>
            </a>
          )}
        </div>
      </form>

      {/* Customer list */}
      <div className="mt-6 space-y-2">
        {(!customers || customers.length === 0) && (
          <p className="py-12 text-center text-muted-foreground">
            {search ? "No customers match your search." : "No customers yet."}
          </p>
        )}

        {customers?.map((customer) => (
          <div
            key={customer.id}
            className="flex items-center justify-between rounded-lg border p-4"
          >
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium">
                  {customer.full_name || "No name"}
                </p>
                {bookingCounts[customer.id] > 0 && (
                  <Badge variant="outline">
                    {bookingCounts[customer.id]} booking
                    {bookingCounts[customer.id] !== 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {customer.email}
                {customer.phone ? ` · ${customer.phone}` : ""}
              </p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              Joined{" "}
              {new Date(customer.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

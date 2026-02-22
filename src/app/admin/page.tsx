export default function AdminDashboardPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
      <p className="mt-2 text-muted-foreground">
        Today&apos;s bookings and quick stats at a glance.
      </p>
      {/* Dashboard stats and timeline — Phase 2 */}
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border p-6">
          <p className="text-sm text-muted-foreground">Bookings Today</p>
          <p className="mt-1 text-3xl font-bold">—</p>
        </div>
        <div className="rounded-lg border p-6">
          <p className="text-sm text-muted-foreground">Revenue Today</p>
          <p className="mt-1 text-3xl font-bold">—</p>
        </div>
        <div className="rounded-lg border p-6">
          <p className="text-sm text-muted-foreground">Upcoming Bookings</p>
          <p className="mt-1 text-3xl font-bold">—</p>
        </div>
      </div>
      <div className="mt-8 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        Daily timeline view coming soon
      </div>
    </div>
  );
}

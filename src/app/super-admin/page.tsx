export default function SuperAdminDashboardPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Platform Dashboard</h1>
      <p className="mt-2 text-muted-foreground">
        Platform-wide overview and statistics.
      </p>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border p-6">
          <p className="text-sm text-muted-foreground">Total Organizations</p>
          <p className="mt-1 text-3xl font-bold">—</p>
        </div>
        <div className="rounded-lg border p-6">
          <p className="text-sm text-muted-foreground">Total Bookings</p>
          <p className="mt-1 text-3xl font-bold">—</p>
        </div>
        <div className="rounded-lg border p-6">
          <p className="text-sm text-muted-foreground">Total Revenue</p>
          <p className="mt-1 text-3xl font-bold">—</p>
        </div>
      </div>
      <div className="mt-8 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        Recent activity feed coming soon
      </div>
    </div>
  );
}

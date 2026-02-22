import Link from "next/link";

export default function OrganizationsPage() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Organizations</h1>
          <p className="mt-2 text-muted-foreground">
            Manage all facilities on the platform.
          </p>
        </div>
        <Link
          href="/super-admin/orgs/new"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Create Organization
        </Link>
      </div>
      {/* Organizations table — Phase 2 */}
      <div className="mt-8 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        Organizations list coming soon
      </div>
    </div>
  );
}

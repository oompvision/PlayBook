export default async function OrgDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">
        Organization Details
      </h1>
      <p className="mt-2 text-muted-foreground">
        View and edit organization {id}.
      </p>
      {/* Org detail/edit form — Phase 2 */}
      <div className="mt-8 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        Organization details coming soon
      </div>
    </div>
  );
}

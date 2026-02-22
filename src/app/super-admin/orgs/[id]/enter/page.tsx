export default async function EnterOrgPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">
        Entering Organization
      </h1>
      <p className="mt-2 text-muted-foreground">
        Switching into org {id} admin dashboard...
      </p>
      {/* Org switching logic — Phase 2 */}
      <div className="mt-8 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        Org switching coming soon
      </div>
    </div>
  );
}

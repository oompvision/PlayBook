import { redirect } from "next/navigation";

// Cookie setting moved to /api/admin/enter/[id] route handler.
// This page exists as a fallback redirect.
export default async function EnterOrgPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/api/admin/enter/${id}`);
}

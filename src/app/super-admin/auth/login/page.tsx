import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";

export default async function SuperAdminLoginPage() {
  // If already logged in as super_admin, go to dashboard
  const auth = await getAuthUser();
  if (auth?.profile.role === "super_admin") {
    redirect("/super-admin");
  }

  // Redirect to shared login page with super_admin context
  redirect("/auth/login?role=super_admin&redirect=/super-admin");
}

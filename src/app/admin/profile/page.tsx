"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { User, Lock, Loader2 } from "lucide-react";

type ProfileData = {
  id: string;
  email: string;
  fullName: string;
  title: string;
  phone: string;
};

export default function AdminProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [passwordMsg, setPasswordMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const [profile, setProfile] = useState<ProfileData>({
    id: "",
    email: "",
    fullName: "",
    title: "",
    phone: "",
  });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: prof } = await supabase.rpc("get_my_profile");
      if (!prof) return;

      const { data: adminProf } = await supabase
        .from("admin_profiles")
        .select("title, phone")
        .eq("id", prof.id)
        .single();

      setProfile({
        id: prof.id,
        email: prof.email || user.email || "",
        fullName: prof.full_name || "",
        title: adminProf?.title || "",
        phone: adminProf?.phone || "",
      });
      setLoading(false);
    }
    loadProfile();
  }, []);

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    setProfileMsg(null);
    setSaving(true);

    try {
      const supabase = createClient();

      // Update profiles table (full_name)
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ full_name: profile.fullName })
        .eq("id", profile.id);

      if (profileError) {
        setProfileMsg({ type: "error", text: profileError.message });
        setSaving(false);
        return;
      }

      // Update admin_profiles table (title, phone)
      const { error: adminError } = await supabase
        .from("admin_profiles")
        .update({ title: profile.title || null, phone: profile.phone || null })
        .eq("id", profile.id);

      if (adminError) {
        setProfileMsg({ type: "error", text: adminError.message });
        setSaving(false);
        return;
      }

      setProfileMsg({ type: "success", text: "Profile updated successfully." });
    } catch {
      setProfileMsg({
        type: "error",
        text: "Something went wrong. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPasswordMsg(null);

    if (newPassword.length < 6) {
      setPasswordMsg({
        type: "error",
        text: "New password must be at least 6 characters.",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "error", text: "Passwords do not match." });
      return;
    }

    setSavingPassword(true);

    try {
      const supabase = createClient();

      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        setPasswordMsg({ type: "error", text: error.message });
        setSavingPassword(false);
        return;
      }

      setPasswordMsg({ type: "success", text: "Password updated successfully." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setPasswordMsg({
        type: "error",
        text: "Something went wrong. Please try again.",
      });
    } finally {
      setSavingPassword(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account information and password.
        </p>
      </div>

      {/* Profile Information Card */}
      <Card>
        <form onSubmit={handleProfileSave}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Account Information</CardTitle>
            </div>
            <CardDescription>
              Update your name, title, and contact information.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {profileMsg && (
              <div
                className={`rounded-md p-3 text-sm ${
                  profileMsg.type === "success"
                    ? "bg-green-50 text-green-700"
                    : "bg-destructive/10 text-destructive"
                }`}
              >
                {profileMsg.text}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={profile.email}
                disabled
                className="bg-gray-50 text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">
                Email cannot be changed.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                type="text"
                placeholder="Jane Smith"
                value={profile.fullName}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, fullName: e.target.value }))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                type="text"
                placeholder="e.g. General Manager"
                value={profile.title}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, title: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="(555) 123-4567"
                value={profile.phone}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, phone: e.target.value }))
                }
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* Change Password Card */}
      <Card>
        <form onSubmit={handlePasswordChange}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Change Password</CardTitle>
            </div>
            <CardDescription>
              Update your password to keep your account secure.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {passwordMsg && (
              <div
                className={`rounded-md p-3 text-sm ${
                  passwordMsg.type === "success"
                    ? "bg-green-50 text-green-700"
                    : "bg-destructive/10 text-destructive"
                }`}
              >
                {passwordMsg.text}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={savingPassword}>
              {savingPassword && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Update Password
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

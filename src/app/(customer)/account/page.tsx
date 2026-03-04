"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Check, MapPin } from "lucide-react";

type ProfileData = {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  org_id: string | null;
};

type LocationData = {
  id: string;
  name: string;
  is_default: boolean;
};

export default function AccountPage() {
  const router = useRouter();
  const supabase = createClient();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  // Location preference state
  const [locations, setLocations] = useState<LocationData[]>([]);
  const [locationsEnabled, setLocationsEnabled] = useState(false);
  const [defaultLocationId, setDefaultLocationId] = useState("");
  const [savedLocationId, setSavedLocationId] = useState("");
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationSuccess, setLocationSuccess] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/auth/login");
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email, phone, org_id")
        .eq("id", user.id)
        .single();

      if (data) {
        setProfile(data);
        setFullName(data.full_name || "");
        setPhone(data.phone || "");

        // Fetch location data if user has an org
        if (data.org_id) {
          const { data: org } = await supabase
            .from("organizations")
            .select("locations_enabled")
            .eq("id", data.org_id)
            .single();

          if (org?.locations_enabled) {
            setLocationsEnabled(true);

            const { data: locs } = await supabase
              .from("locations")
              .select("id, name, is_default")
              .eq("org_id", data.org_id)
              .eq("is_active", true)
              .order("is_default", { ascending: false })
              .order("name");

            setLocations(locs || []);

            // Fetch user's current preference
            const { data: pref } = await supabase
              .from("user_location_preferences")
              .select("default_location_id")
              .eq("user_id", user.id)
              .eq("org_id", data.org_id)
              .single();

            if (pref) {
              setDefaultLocationId(pref.default_location_id);
              setSavedLocationId(pref.default_location_id);
            } else {
              // Default to org's default location
              const orgDefault = (locs || []).find((l) => l.is_default);
              if (orgDefault) {
                setDefaultLocationId(orgDefault.id);
                setSavedLocationId(orgDefault.id);
              }
            }
          }
        }
      }
      setLoading(false);
    }

    loadProfile();
  }, [router, supabase]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess(false);

    if (!profile) return;

    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        full_name: fullName || null,
        phone: phone || null,
      })
      .eq("id", profile.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    setSuccess(true);
    setSaving(false);
    setTimeout(() => setSuccess(false), 3000);
  }

  async function handleSaveLocation() {
    if (!profile?.org_id || !defaultLocationId) return;
    setLocationSaving(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    const { error: upsertError } = await supabase
      .from("user_location_preferences")
      .upsert(
        {
          user_id: user.id,
          org_id: profile.org_id,
          default_location_id: defaultLocationId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,org_id" }
      );

    if (!upsertError) {
      setSavedLocationId(defaultLocationId);
      setLocationSuccess(true);
      setTimeout(() => setLocationSuccess(false), 3000);
    }
    setLocationSaving(false);
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  const hasChanges =
    fullName !== (profile.full_name || "") ||
    phone !== (profile.phone || "");

  return (
    <div className="flex flex-1 flex-col items-center p-4 pt-8 sm:pt-16">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader className="text-center">
            {/* Avatar */}
            <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground text-xl font-semibold">
              {fullName
                ? fullName
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2)
                : profile.email[0].toUpperCase()}
            </div>
            <CardTitle className="text-xl">My Account</CardTitle>
            <CardDescription>{profile.email}</CardDescription>
          </CardHeader>
          <form onSubmit={handleSave}>
            <CardContent className="space-y-4">
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              {success && (
                <div className="flex items-center gap-2 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
                  <Check className="h-4 w-4" />
                  Profile updated successfully
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="account-name">Full Name</Label>
                <Input
                  id="account-name"
                  type="text"
                  placeholder="John Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="account-phone">Phone Number</Label>
                <Input
                  id="account-phone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="account-email">Email</Label>
                <Input
                  id="account-email"
                  type="email"
                  value={profile.email}
                  disabled
                  className="bg-muted"
                />
                <p className="text-xs text-muted-foreground">
                  Email cannot be changed here.
                </p>
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={saving || !hasChanges}
              >
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </CardContent>
          </form>
        </Card>

        {/* Default Location (multi-location orgs only) */}
        {locationsEnabled && locations.length > 1 && (
          <Card className="mt-4">
            <CardHeader>
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg">Default Location</CardTitle>
              </div>
              <CardDescription>
                Choose your preferred location for bookings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {locationSuccess && (
                <div className="flex items-center gap-2 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
                  <Check className="h-4 w-4" />
                  Default location updated
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="default-location">Location</Label>
                <select
                  id="default-location"
                  value={defaultLocationId}
                  onChange={(e) => setDefaultLocationId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}{loc.is_default ? " (Default)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                onClick={handleSaveLocation}
                className="w-full"
                disabled={locationSaving || defaultLocationId === savedLocationId}
              >
                {locationSaving ? "Saving..." : "Update Default Location"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
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

export function CreateOrgForm({
  createOrg,
}: {
  createOrg: (formData: FormData) => Promise<void>;
}) {
  return (
    <Suspense>
      <CreateOrgFormInner createOrg={createOrg} />
    </Suspense>
  );
}

function CreateOrgFormInner({
  createOrg,
}: {
  createOrg: (formData: FormData) => Promise<void>;
}) {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  function handleNameChange(value: string) {
    setName(value);
    // Auto-generate slug from name
    setSlug(
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold tracking-tight">
        Create Organization
      </h1>
      <p className="mt-2 text-muted-foreground">
        Set up a new facility with an admin account.
      </p>

      {error && (
        <div className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <form action={createOrg} className="mt-8 space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Facility Details</CardTitle>
            <CardDescription>
              Basic information about the facility.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Facility Name *</Label>
              <Input
                id="name"
                name="name"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g., TopSwing Indoor Golf"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">URL Slug *</Label>
              <Input
                id="slug"
                name="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="e.g., topswing-indoor-golf"
                required
              />
              <p className="text-xs text-muted-foreground">
                This will be used in the facility URL: {slug || "your-slug"}
                .playbook.com
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <select
                  id="timezone"
                  name="timezone"
                  defaultValue="America/New_York"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="America/New_York">Eastern (ET)</option>
                  <option value="America/Chicago">Central (CT)</option>
                  <option value="America/Denver">Mountain (MT)</option>
                  <option value="America/Los_Angeles">Pacific (PT)</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="default_slot_duration_minutes">
                  Default Slot Duration (min)
                </Label>
                <Input
                  id="default_slot_duration_minutes"
                  name="default_slot_duration_minutes"
                  type="number"
                  defaultValue={60}
                  min={15}
                  max={240}
                  step={15}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <textarea
                id="description"
                name="description"
                rows={3}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Tell customers about this facility..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                name="address"
                placeholder="123 Main St, City, State ZIP"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                placeholder="(555) 123-4567"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Facility Admin (Optional)</CardTitle>
            <CardDescription>
              Create an admin account for this facility. You can also add admins
              later.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="admin_name">Admin Name</Label>
              <Input
                id="admin_name"
                name="admin_name"
                placeholder="John Doe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin_email">Admin Email</Label>
              <Input
                id="admin_email"
                name="admin_email"
                type="email"
                placeholder="admin@facility.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin_password">Admin Password</Label>
              <Input
                id="admin_password"
                name="admin_password"
                type="password"
                placeholder="At least 6 characters"
                minLength={6}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button type="submit" size="lg">
            Create Organization
          </Button>
        </div>
      </form>
    </div>
  );
}

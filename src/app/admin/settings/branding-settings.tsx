"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { updateOrgImage } from "./actions";
import Image from "next/image";
import { Upload, X, ImageIcon } from "lucide-react";

function ImageUploader({
  label,
  description,
  currentUrl,
  orgId,
  field,
  aspect,
}: {
  label: string;
  description: string;
  currentUrl: string | null;
  orgId: string;
  field: "logo_url" | "cover_photo_url";
  aspect: "square" | "wide";
}) {
  const [preview, setPreview] = useState<string | null>(currentUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const type = field === "logo_url" ? "logo" : "cover";

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be under 5MB.");
      return;
    }

    setError(null);
    setPreview(URL.createObjectURL(file));
    setUploading(true);

    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${orgId}/${type}-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("org-assets")
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from("org-assets")
        .getPublicUrl(path);

      const result = await updateOrgImage(field, data.publicUrl);
      if (result.error) throw new Error(result.error);
    } catch (err) {
      console.error("Upload failed:", err);
      setError(err instanceof Error ? err.message : "Upload failed.");
      setPreview(currentUrl);
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    setUploading(true);
    setError(null);

    try {
      const result = await updateOrgImage(field, null);
      if (result.error) throw new Error(result.error);
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove image.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <p className="text-xs text-muted-foreground">{description}</p>

      <div
        className={`relative overflow-hidden rounded-lg border-2 border-dashed transition-colors ${
          aspect === "square" ? "h-32 w-32" : "h-40 w-full"
        } ${!preview ? "hover:border-primary/50 cursor-pointer" : ""}`}
        onClick={() => !preview && inputRef.current?.click()}
      >
        {preview ? (
          <>
            <Image
              src={preview}
              alt={label}
              fill
              className={`${aspect === "square" ? "object-cover rounded-lg" : "object-cover"}`}
              unoptimized
            />
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/0 opacity-0 transition-all hover:bg-black/40 hover:opacity-100">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  inputRef.current?.click();
                }}
                disabled={uploading}
              >
                <Upload className="mr-1 h-3 w-3" />
                Replace
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove();
                }}
                disabled={uploading}
              >
                <X className="mr-1 h-3 w-3" />
                Remove
              </Button>
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
            <ImageIcon className="h-6 w-6" />
            <span className="text-xs">
              {uploading ? "Uploading..." : "Click to upload"}
            </span>
          </div>
        )}
        {uploading && preview && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}

export function BrandingSettings({
  orgId,
  logoUrl,
  coverPhotoUrl,
}: {
  orgId: string;
  logoUrl: string | null;
  coverPhotoUrl: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Branding</CardTitle>
        <CardDescription>
          Customize how your facility appears to customers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ImageUploader
          label="Logo"
          description="Displayed on booking pages as your facility's profile picture. Square images work best."
          currentUrl={logoUrl}
          orgId={orgId}
          field="logo_url"
          aspect="square"
        />
        <ImageUploader
          label="Cover Photo"
          description="Displayed as a hero image on your facility's homepage. Use a wide landscape image (recommended 1200x400+)."
          currentUrl={coverPhotoUrl}
          orgId={orgId}
          field="cover_photo_url"
          aspect="wide"
        />
      </CardContent>
    </Card>
  );
}

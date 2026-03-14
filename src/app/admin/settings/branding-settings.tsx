"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
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

    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }

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
      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
        {label}
      </label>
      <p className="text-xs text-gray-400 dark:text-gray-500">{description}</p>

      <div
        className={`relative overflow-hidden rounded-xl border-2 border-dashed transition-colors ${
          aspect === "square" ? "h-32 w-32" : "h-40 w-full"
        } ${
          !preview
            ? "border-gray-300 hover:border-blue-400 cursor-pointer dark:border-gray-700 dark:hover:border-blue-600"
            : "border-gray-200 dark:border-gray-700"
        }`}
        onClick={() => !preview && inputRef.current?.click()}
      >
        {preview ? (
          <>
            <Image
              src={preview}
              alt={label}
              fill
              className={`${aspect === "square" ? "object-cover rounded-xl" : "object-cover"}`}
              unoptimized
            />
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/0 opacity-0 transition-all hover:bg-black/40 hover:opacity-100">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  inputRef.current?.click();
                }}
                disabled={uploading}
                className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
              >
                <Upload className="h-3 w-3" />
                Replace
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove();
                }}
                disabled={uploading}
                className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-red-700"
              >
                <X className="h-3 w-3" />
                Remove
              </button>
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-gray-400 dark:text-gray-500">
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
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
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
    <div className="space-y-6">
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
    </div>
  );
}

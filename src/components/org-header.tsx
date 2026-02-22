import Image from "next/image";
import Link from "next/link";

export function OrgHeader({
  name,
  logoUrl,
}: {
  name: string;
  logoUrl: string | null;
}) {
  return (
    <Link href="/" className="flex items-center gap-3 group">
      {logoUrl ? (
        <Image
          src={logoUrl}
          alt={name}
          width={40}
          height={40}
          className="rounded-full object-cover h-10 w-10"
          unoptimized
        />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">
          {name.charAt(0).toUpperCase()}
        </div>
      )}
      <span className="font-semibold text-lg group-hover:underline">{name}</span>
    </Link>
  );
}

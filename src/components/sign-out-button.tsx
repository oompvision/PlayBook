import { Button } from "@/components/ui/button";

export function SignOutButton({
  variant = "ghost",
  size = "sm",
  className = "mt-2 w-full justify-start px-0 text-muted-foreground hover:text-foreground",
}: {
  variant?: "ghost" | "outline" | "default" | "secondary" | "destructive" | "link";
  size?: "sm" | "default" | "lg" | "icon";
  className?: string;
} = {}) {
  return (
    <form action="/auth/signout" method="POST">
      <Button
        type="submit"
        variant={variant}
        size={size}
        className={className}
      >
        Sign Out
      </Button>
    </form>
  );
}

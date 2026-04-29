import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

function getInitials(name?: string, email?: string): string {
  if (name) {
    return name
      .split(/\s+/)
      .map((s) => s.charAt(0))
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }
  if (email) return email.charAt(0).toUpperCase();
  return "?";
}

// fallow-ignore-next-line complexity
export function UserAvatar({
  name,
  email,
  size,
  className,
}: {
  name?: string;
  email?: string;
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  const seed = encodeURIComponent(name ?? email ?? "default");
  const src = `https://api.dicebear.com/9.x/lorelei/svg?seed=${seed}`;
  const initials = getInitials(name, email);

  return (
    <Avatar size={size} className={className}>
      <AvatarImage src={src} alt={name ?? email ?? "User avatar"} />
      <AvatarFallback>{initials}</AvatarFallback>
    </Avatar>
  );
}

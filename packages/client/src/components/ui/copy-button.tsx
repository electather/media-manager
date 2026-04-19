import { useState } from "react";
import { ClipboardCopyIcon, CheckIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";

interface CopyButtonProps extends VariantProps<typeof buttonVariants> {
  value: string;
  label?: string;
  className?: string;
  iconClassName?: string;
  title?: string;
}

function CopyButton({
  value,
  label,
  variant = "ghost",
  size,
  className,
  iconClassName,
  title = "Copy to clipboard",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable; ignore silently.
    }
  };

  const Icon = copied ? CheckIcon : ClipboardCopyIcon;

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleCopy}
      title={title}
      className={cn(className)}
    >
      <Icon className={cn(iconClassName)} />
      {label !== undefined && (copied ? "Copied" : label)}
    </Button>
  );
}

export { CopyButton };

import { ClipboardCopyIcon, CheckIcon } from "lucide-react";

import { useCopyFeedback } from "@/shared/hooks/use-copy-feedback";
import { Button, buttonVariants } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import type { VariantProps } from "class-variance-authority";

interface CopyButtonProps extends VariantProps<typeof buttonVariants> {
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  iconClassName?: string;
  title?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}

function CopyButton({
  value,
  label,
  copiedLabel = "Copied",
  variant = "ghost",
  size,
  className,
  iconClassName,
  title = "Copy to clipboard",
  "aria-label": ariaLabel,
  "data-testid": testId,
}: CopyButtonProps) {
  const { copied, copy } = useCopyFeedback();

  const handleCopy = () => {
    void copy(value);
  };

  const Icon = copied ? CheckIcon : ClipboardCopyIcon;

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleCopy}
      title={title}
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn(className)}
    >
      <Icon className={cn(iconClassName)} />
      {label !== undefined && (copied ? copiedLabel : label)}
    </Button>
  );
}

export { CopyButton };

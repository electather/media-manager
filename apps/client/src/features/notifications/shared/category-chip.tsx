import type { NotificationCategory } from "@nama/shared/notifications";
import { RadioGroupItem } from "@/shared/ui/radio-group";
import { CATEGORY_META } from "./types";

interface Props {
  value: string;
  category?: NotificationCategory;
  label: string;
  count?: number;
}

// fallow-ignore-next-line complexity
export function CategoryChip({ value, category, label, count }: Props) {
  const meta = category ? CATEGORY_META[category] : null;
  const MetaIcon = meta?.Icon;
  return (
    <RadioGroupItem value={value}>
      {MetaIcon && <MetaIcon className="size-3" />}
      <span>{label}</span>
      {count != null && <span className="text-xs tabular-nums opacity-70">{count}</span>}
    </RadioGroupItem>
  );
}

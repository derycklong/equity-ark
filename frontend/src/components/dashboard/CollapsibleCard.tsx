import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

interface CollapsibleCardProps {
  title: ReactNode;
  subtitle?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  children: ReactNode;
}

export default function CollapsibleCard({
  title,
  subtitle,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  className,
  headerClassName,
  contentClassName,
  children,
}: CollapsibleCardProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const toggle = () => {
    const next = !open;
    if (isControlled) {
      onOpenChange?.(next);
    } else {
      setInternalOpen(next);
    }
  };

  return (
    <div
      className={cn(
        "rounded-2xl border border-line bg-bg-card transition-shadow hover:border-line/80 hover:shadow-sm",
        className,
      )}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={cn(
          "w-full px-4 py-2.5 flex items-center justify-between gap-2 bg-bg-soft/30 hover:bg-bg-soft/60 transition-colors text-left rounded-2xl",
          open && "rounded-b-none",
          headerClassName,
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{title}</div>
          {subtitle && <div className="text-sm text-ink-faint truncate">{subtitle}</div>}
        </div>
        <ChevronDown
          size={14}
          className={cn(
            "shrink-0 text-ink-faint transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      <div
        className={cn(
          "grid transition-all duration-200 ease-in-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className={cn("p-4", contentClassName)}>{children}</div>
        </div>
      </div>
    </div>
  );
}

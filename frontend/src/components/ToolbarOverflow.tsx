import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "../lib/utils";

interface ToolbarOverflowProps {
  /**
   * Items that should always remain visible in the toolbar (left of the
   * `⋯` button on small screens). On md+ these are also visible.
   */
  primary: ReactNode;
  /**
   * Items collapsed into a `⋯` dropdown on small screens. On md+ these
   * are also rendered inline to the right of `primary`.
   */
  secondary?: ReactNode;
  className?: string;
  secondaryClassName?: string;
}

/**
 * Toolbar that keeps the primary action(s) visible on every screen and
 * collapses secondary actions into a `⋯` menu on small screens. On md+
 * everything is shown inline (so the desktop layout is unchanged).
 */
export default function ToolbarOverflow({
  primary,
  secondary,
  className,
  secondaryClassName,
}: ToolbarOverflowProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={cn("flex items-center gap-2 flex-wrap", className)}>
      <div className="flex items-center gap-2 flex-wrap">{primary}</div>
      {secondary && (
        <>
          <div className={cn("hidden md:flex items-center gap-2 flex-wrap", secondaryClassName)}>
            {secondary}
          </div>
          <div className="relative md:hidden" ref={ref}>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-label="More actions"
              aria-expanded={open}
              className="flex items-center justify-center rounded-md border border-line bg-bg-card text-ink-dim hover:text-ink p-1.5"
            >
              <MoreHorizontal size={16} />
            </button>
            {open && (
              <div className="absolute right-0 top-full mt-1 z-30 min-w-[180px] rounded-lg border border-line bg-bg-card shadow-lg py-1">
                <div className="flex flex-col" onClick={() => setOpen(false)}>
                  {secondary}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

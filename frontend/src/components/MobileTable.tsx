import { type ReactNode } from "react";
import { cn } from "../lib/utils";

interface MobileTableProps<T> {
  items: T[];
  keyOf: (item: T, index: number) => string | number;
  renderCard: (item: T, index: number) => ReactNode;
  renderTable: () => ReactNode;
  className?: string;
  cardsClassName?: string;
  /**
   * Extra classes applied to the desktop (md+) wrapper around the table.
   * Use this when the table needs to participate in a flex chain
   * (e.g. a height-constrained scroll container).
   */
  tableWrapperClassName?: string;
  empty?: ReactNode;
}

/**
 * Renders the wide table view on md+ screens and a card list on smaller
 * screens. The card variant is a deliberate presentation designed for
 * 360–640 px viewports where a 7+ column table doesn't fit.
 */
export default function MobileTable<T>({
  items,
  keyOf,
  renderCard,
  renderTable,
  className,
  cardsClassName,
  tableWrapperClassName,
  empty,
}: MobileTableProps<T>) {
  return (
    <div className={className}>
      {/* Mobile card list (hidden on md+) */}
      <div className={cn("md:hidden space-y-2", cardsClassName)}>
        {items.length === 0 && empty ? (
          <div className="rounded-lg border border-line bg-bg-card px-4 py-8 text-center text-ink-faint text-sm">
            {empty}
          </div>
        ) : (
          items.map((item, i) => (
            <div key={keyOf(item, i)}>{renderCard(item, i)}</div>
          ))
        )}
      </div>
      {/* Desktop / tablet table (hidden on small screens) */}
      <div className={cn("hidden md:block md:min-h-0", tableWrapperClassName)}>
        {renderTable()}
      </div>
    </div>
  );
}

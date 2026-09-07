import { type ReactNode } from "react";
import { Box, Paper, Typography, useMediaQuery } from "@mui/material";
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
  const isDesktop = useMediaQuery((theme) => theme.breakpoints.up("md"), { noSsr: true });

  return (
    <Box className={className}>
      {!isDesktop && (
        <Box
          className={cn("md:hidden", cardsClassName)}
          sx={{ display: "flex", flexDirection: "column", gap: 1.5, p: { xs: 1, sm: 1.5 } }}
        >
          {items.length === 0 && empty ? (
            <Paper variant="outlined" sx={{ px: 2, py: 4, textAlign: "center" }}>
              <Typography variant="body2" color="text.secondary">{empty}</Typography>
            </Paper>
          ) : (
            items.map((item, i) => (
              <div key={keyOf(item, i)}>{renderCard(item, i)}</div>
            ))
          )}
        </Box>
      )}
      {isDesktop && (
        <Box
          className={cn("md:min-h-0", tableWrapperClassName)}
          sx={{ display: "block", minHeight: { md: 0 } }}
        >
          {renderTable()}
        </Box>
      )}
    </Box>
  );
}

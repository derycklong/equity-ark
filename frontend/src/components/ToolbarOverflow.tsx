import { useState, type ReactNode } from "react";
import { Box, IconButton, Menu, Stack, Tooltip } from "@mui/material";
import MoreHorizRounded from "@mui/icons-material/MoreHorizRounded";
import { cn } from "../lib/utils";

interface ToolbarOverflowProps {
  /**
   * Items that should always remain visible in the toolbar (left of the
   * `⋯` button on small screens). On md+ these are also visible.
   */
  primary: ReactNode;
  /**
   * Items collapsed into a `⋯` dropdown on every screen.
   */
  secondary?: ReactNode;
  className?: string;
}

/**
 * Toolbar that keeps the primary action(s) visible on every screen and
 * collapses secondary actions into a `⋯` menu on every screen, keeping the
 * toolbar focused on its primary action.
 */
export default function ToolbarOverflow({
  primary,
  secondary,
  className,
}: ToolbarOverflowProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", alignItems: "center", width: { xs: "100%", sm: "auto" } }} className={cn(className)}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", alignItems: "center", minWidth: 0, flex: { xs: 1, sm: "initial" } }}>{primary}</Stack>
      {secondary && (
        <Box sx={{ display: "block", flexShrink: 0 }}>
            <Tooltip title="More actions">
              <IconButton
                size="small"
                onClick={(event) => setAnchorEl(event.currentTarget)}
                aria-label="More actions"
                aria-expanded={open}
                sx={{ border: 1, borderColor: "divider" }}
              >
                <MoreHorizRounded fontSize="small" />
              </IconButton>
            </Tooltip>
            <Menu
              anchorEl={anchorEl}
              open={open}
              onClose={() => setAnchorEl(null)}
              slotProps={{ paper: { sx: { minWidth: 220, mt: 0.5, p: 0.5 } } }}
            >
              <Box onClick={() => setAnchorEl(null)} sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>{secondary}</Box>
            </Menu>
        </Box>
      )}
    </Stack>
  );
}

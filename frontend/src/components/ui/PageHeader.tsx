import type { ReactNode } from "react";
import { Box, Stack, Typography } from "@mui/material";

export default function PageHeader({
  title,
  subtitle,
  icon,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: { xs: "flex-start", sm: "center" }, gap: { xs: 1.25, sm: 1.5 }, flexWrap: "wrap" }}>
      <Stack direction="row" spacing={{ xs: 1, sm: 1.25 }} sx={{ alignItems: "center", minWidth: 0, flex: { xs: "1 1 100%", sm: "0 1 auto" } }}>
        {icon && <Box sx={{ color: "primary.main", display: "flex", p: 0.75, borderRadius: 2, bgcolor: "action.selected" }}>{icon}</Box>}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h1" component="h1" sx={{ fontSize: { xs: "1.2rem", sm: "1.5rem" }, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {title}
          </Typography>
          {subtitle && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>{subtitle}</Typography>}
        </Box>
      </Stack>
      {actions && <Box sx={{ width: { xs: "100%", sm: "auto" }, minWidth: 0 }}>{actions}</Box>}
    </Stack>
  );
}

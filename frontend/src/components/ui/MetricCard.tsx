import type { ReactNode } from "react";
import { Card, CardContent, Stack, Typography } from "@mui/material";

export default function MetricCard({
  label,
  value,
  supporting,
  icon,
  tone = "default",
  meta,
}: {
  label: string;
  value: ReactNode;
  supporting?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "success" | "error" | "warning" | "primary";
  meta?: ReactNode;
}) {
  const color = tone === "default" ? "text.primary" : `${tone}.main`;

  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardContent sx={{ p: { xs: 1.5, sm: 2 }, "&:last-child": { pb: { xs: 1.5, sm: 2 } } }}>
        <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", gap: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {label}
          </Typography>
          {icon && <Stack sx={{ color, display: "flex" }}>{icon}</Stack>}
        </Stack>
        <Stack direction="row" sx={{ alignItems: "baseline", gap: 1, mt: 0.75, flexWrap: "wrap" }}>
          <Typography variant="h2" sx={{ color, fontSize: { xs: "1.05rem", sm: "1.2rem" }, fontVariantNumeric: "tabular-nums" }}>
            {value}
          </Typography>
          {meta && <Typography variant="body2" sx={{ color, fontVariantNumeric: "tabular-nums" }}>{meta}</Typography>}
        </Stack>
        {supporting && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.4 }} noWrap>{supporting}</Typography>}
      </CardContent>
    </Card>
  );
}

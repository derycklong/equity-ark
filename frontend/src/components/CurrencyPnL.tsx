import { Box, Card, CardHeader, LinearProgress, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import PaidOutlined from "@mui/icons-material/PaidOutlined";
import { fmtPct, fmtMoneyFull, ccySymbol } from "../lib/utils";
import { useDashboard } from "../hooks/usePortfolio";

interface BreakdownRow {
  currency: string;
  current_value: number | null;
  current_value_pct: number | null;
  day_change: number | null;
  day_change_pct: number | null;
  current_pnl: number | null;
  current_pnl_div: number | null;
  current_pnl_div_pct: number | null;
  closed_pnl: number | null;
  overall_pnl_div: number | null;
  overall_pnl_div_pct: number | null;
  total_div: number | null;
}

interface Breakdown {
  rows: BreakdownRow[];
  totals: BreakdownRow & { current_value_base?: number | null };
  base_currency: string;
  header: { twr: number; xirr: number; capital: number; net_worth: number; base_currency: string };
}

const CCY_COLORS: Record<string, string> = {
  USD: "primary.main",
  SGD: "warning.main",
  HKD: "success.main",
  GBP: "error.main",
  CNY: "secondary.main",
  EUR: "info.main",
};

export default function CurrencyPnL() {
  const { data: dashboardData, isLoading } = useDashboard();
  const data = dashboardData?.breakdown as Breakdown | undefined;

  if (isLoading) return <Typography variant="body2" color="text.secondary">Loading P&amp;L…</Typography>;
  if (!data) return null;

  const baseCcy = data.base_currency;
  const valueColor = (n: number) => (n > 0 ? "success.main" : n < 0 ? "error.main" : "text.secondary");
  const maxPct = Math.max(...data.rows.map((row) => row.current_value_pct ?? 0), 1);

  return (
    <Card variant="outlined" sx={{ overflow: "hidden" }}>
      <CardHeader
        avatar={<PaidOutlined fontSize="small" color="primary" />}
        title="P&amp;L by currency"
        titleTypographyProps={{ variant: "subtitle2", fontWeight: 700 }}
        sx={{ px: { xs: 1.25, sm: 2 }, py: { xs: 0.9, sm: 1.25 }, bgcolor: "action.hover", borderBottom: 1, borderColor: "divider", "& .MuiCardHeader-avatar": { mr: { xs: 0.75, sm: 1.5 } } }}
      />
      <Box sx={{ display: { xs: "grid", sm: "none" }, gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 0.75, p: 1 }}>
        {data.rows.map((row) => {
          const marketValue = row.current_value ?? 0;
          const total = row.overall_pnl_div ?? 0;
          const color = CCY_COLORS[row.currency] || "text.secondary";
          return (
            <Box key={row.currency} sx={{ minWidth: 0, p: 1, border: 1, borderColor: "divider", borderRadius: 1.5, bgcolor: "background.paper" }}>
              <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 0.5 }}>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", minWidth: 0 }}>
                  <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
                  <Typography variant="caption" sx={{ fontWeight: 750 }}>{row.currency}</Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>{fmtPct(row.current_value_pct ?? 0, 1)}</Typography>
              </Stack>
              <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }} noWrap>{fmtMoneyFull(marketValue, row.currency)}</Typography>
              <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "baseline", gap: 0.5, mt: 0.25 }}>
                <Typography variant="caption" color="text.secondary">Total P&amp;L</Typography>
                <Typography variant="caption" color={valueColor(total)} sx={{ fontWeight: 750, fontVariantNumeric: "tabular-nums" }} noWrap>{fmtMoneyFull(total, row.currency)}</Typography>
              </Stack>
            </Box>
          );
        })}
        <Box sx={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, p: 1, borderTop: 2, borderColor: "divider", bgcolor: "action.hover" }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary">Total market value · {baseCcy}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 750, fontVariantNumeric: "tabular-nums" }} noWrap>{fmtMoneyFull(data.totals.current_value ?? 0, baseCcy)}</Typography>
          </Box>
          <Box sx={{ minWidth: 0, textAlign: "right" }}>
            <Typography variant="caption" color="text.secondary">Total P&amp;L</Typography>
            <Typography variant="body2" color={valueColor(data.totals.overall_pnl_div ?? 0)} sx={{ fontWeight: 750, fontVariantNumeric: "tabular-nums" }} noWrap>{fmtMoneyFull(data.totals.overall_pnl_div ?? 0, baseCcy)}</Typography>
          </Box>
        </Box>
      </Box>
      <TableContainer sx={{ overflowX: "auto", display: { xs: "none", sm: "block" } }}>
        <Table size="small" sx={{ minWidth: 700 }}>
          <TableHead>
            <TableRow>
              <TableCell>Currency</TableCell>
              <TableCell align="right">Market value</TableCell>
              <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }}>Day</TableCell>
              <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }}>Unrealized</TableCell>
              <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }}>Realized</TableCell>
              <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }}>Dividends</TableCell>
              <TableCell align="right">Total P&amp;L</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.rows.map((row) => {
              const marketValue = row.current_value ?? 0;
              const day = row.day_change ?? 0;
              const unrealized = row.current_pnl ?? 0;
              const realized = row.closed_pnl ?? 0;
              const dividends = row.total_div ?? 0;
              const total = row.overall_pnl_div ?? 0;
              const color = CCY_COLORS[row.currency] || "text.secondary";
              return (
                <TableRow key={row.currency} hover>
                  <TableCell>
                    <Stack spacing={0.5}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: 1, bgcolor: color, flexShrink: 0 }} />
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{row.currency}</Typography>
                        <Typography variant="caption" color="text.secondary">{fmtPct(row.current_value_pct ?? 0, 1)}</Typography>
                      </Stack>
                      <LinearProgress variant="determinate" value={Math.max(Math.min(((row.current_value_pct ?? 0) / maxPct) * 100, 100), 2)} sx={{ height: 3, borderRadius: 2, bgcolor: "action.hover", "& .MuiLinearProgress-bar": { bgcolor: color } }} />
                    </Stack>
                  </TableCell>
                  <TableCell align="right"><Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtMoneyFull(marketValue, row.currency)}</Typography></TableCell>
                  <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" }, color: valueColor(day), fontVariantNumeric: "tabular-nums" }}>
                    <Typography variant="body2" color="inherit" sx={{ fontVariantNumeric: "tabular-nums" }}>{fmtMoneyFull(day, row.currency)}</Typography>
                    <Typography variant="caption" color="inherit">{fmtPct(row.day_change_pct ?? 0, 2)}</Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" }, color: valueColor(unrealized), fontVariantNumeric: "tabular-nums" }}>{fmtMoneyFull(unrealized, row.currency)}</TableCell>
                  <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" }, color: valueColor(realized), fontVariantNumeric: "tabular-nums" }}>{fmtMoneyFull(realized, row.currency)}</TableCell>
                  <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" }, color: valueColor(dividends), fontVariantNumeric: "tabular-nums" }}>{fmtMoneyFull(dividends, row.currency)}</TableCell>
                  <TableCell align="right" sx={{ color: valueColor(total), fontVariantNumeric: "tabular-nums" }}>
                    <Typography variant="body2" color="inherit" sx={{ fontWeight: 700 }}>{fmtMoneyFull(total, row.currency)}</Typography>
                    <Typography variant="caption" color="inherit">{fmtPct(row.overall_pnl_div_pct ?? 0, 1)}</Typography>
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow sx={{ bgcolor: "action.hover", "& td": { borderTop: 2, borderColor: "divider" } }}>
              <TableCell><Typography variant="body2" sx={{ fontWeight: 700 }}>Total ({baseCcy})</Typography><Typography variant="caption" color="text.secondary">100% of portfolio</Typography></TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}><Typography sx={{ fontWeight: 700 }}>{fmtMoneyFull(data.totals.current_value ?? 0, baseCcy)}</Typography></TableCell>
              <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" }, color: valueColor(data.totals.day_change ?? 0), fontVariantNumeric: "tabular-nums" }}>{fmtMoneyFull(data.totals.day_change ?? 0, baseCcy)}<Typography variant="caption" sx={{ display: "block" }} color="inherit">{fmtPct(data.totals.day_change_pct ?? 0, 2)}</Typography></TableCell>
              <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" }, color: valueColor(data.totals.current_pnl ?? 0), fontVariantNumeric: "tabular-nums" }}>{fmtMoneyFull(data.totals.current_pnl ?? 0, baseCcy)}</TableCell>
              <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" }, color: valueColor(data.totals.closed_pnl ?? 0), fontVariantNumeric: "tabular-nums" }}>{fmtMoneyFull(data.totals.closed_pnl ?? 0, baseCcy)}</TableCell>
              <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" }, color: valueColor(data.totals.total_div ?? 0), fontVariantNumeric: "tabular-nums" }}>{fmtMoneyFull(data.totals.total_div ?? 0, baseCcy)}</TableCell>
              <TableCell align="right" sx={{ color: valueColor(data.totals.overall_pnl_div ?? 0), fontVariantNumeric: "tabular-nums" }}><Typography sx={{ fontWeight: 700 }} color="inherit">{fmtMoneyFull(data.totals.overall_pnl_div ?? 0, baseCcy)}</Typography><Typography variant="caption" sx={{ display: "block" }} color="inherit">{fmtPct(data.totals.overall_pnl_div_pct ?? 0, 1)}</Typography></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  );
}

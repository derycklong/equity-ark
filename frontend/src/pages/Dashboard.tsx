import { useMemo, type ElementType } from "react";
import { Box, Card, CardContent, Chip, Divider, Stack, Typography } from "@mui/material";
import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRounded from "@mui/icons-material/ArrowUpwardRounded";
import BriefcaseOutlined from "@mui/icons-material/BusinessCenterOutlined";
import InsightsOutlined from "@mui/icons-material/InsightsOutlined";
import PaidOutlined from "@mui/icons-material/PaidOutlined";
import TrendingDownRounded from "@mui/icons-material/TrendingDownRounded";
import TrendingUpRounded from "@mui/icons-material/TrendingUpRounded";
import { fmtMoney, fmtPct } from "../lib/utils";
import CurrencyPnL from "../components/CurrencyPnL";
import NetWorthChart from "../components/dashboard/NetWorthChart";
import { useDashboard } from "../hooks/usePortfolio";
import { LoadingScreen } from "../components/LoadingScreen";
import MetricCard from "../components/ui/MetricCard";

function Pct({ p, digits = 1 }: { p: number | null | undefined; digits?: number }) {
  if (p === null || p === undefined) return <Typography component="span" color="text.disabled">—</Typography>;
  return <Typography component="span" sx={{ color: p >= 0 ? "success.main" : "error.main", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtPct(p, digits)}</Typography>;
}

export default function Dashboard() {
  const { data, isLoading } = useDashboard();
  const holdings = data?.holdings || [];
  const movers = useMemo(
    () => [...holdings].filter((h: any) => h.change_pct_7d !== null && h.change_pct_7d !== undefined),
    [holdings],
  );
  const bestSevenDay = useMemo(
    () => [...movers].sort((a: any, b: any) => (b.change_pct_7d || 0) - (a.change_pct_7d || 0)).slice(0, 3),
    [movers],
  );
  const worstSevenDay = useMemo(
    () => [...movers].sort((a: any, b: any) => (a.change_pct_7d || 0) - (b.change_pct_7d || 0)).slice(0, 3),
    [movers],
  );

  if (isLoading) return <LoadingScreen />;
  if (!data || !data.summary || !data.breakdown) return <Typography color="text.secondary">No portfolio data available.</Typography>;

  const summary = data.summary;
  const dividends = data.dividends;
  const breakdown = data.breakdown;
  const totals = breakdown.totals;
  const ccy = breakdown.base_currency;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" }, gap: 1.5 }}>
        <Card variant="outlined">
          <CardContent sx={{ p: { xs: 1.5, sm: 2 }, "&:last-child": { pb: { xs: 1.5, sm: 2 } } }}>
            <DayInline pct={summary.day_change_pct} amount={summary.day_change} ccy={ccy} />
            {data.benchmarks && (
              <>
                <Divider sx={{ my: 1.25 }} />
                <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap" }}>
                  {[
                    { key: "sp500", label: "S&P 500" },
                    { key: "nasdaq", label: "NASDAQ" },
                    { key: "dow", label: "Dow" },
                  ].map(({ key, label }) => {
                    const pct = data.benchmarks[key]?.change_pct;
                    const formattedPct = pct != null ? fmtPct(pct, 2) : "—";
                    const isNegative = pct != null && (pct < 0 || formattedPct.startsWith("-"));
                    return (
                      <Stack key={key} direction="row" spacing={0.5} sx={{ alignItems: "baseline" }}>
                        <Typography variant="caption" color="text.secondary">{label}</Typography>
                        <Typography
                          variant="caption"
                          sx={{
                            color: pct == null ? "text.disabled" : isNegative ? "error.main" : "success.main",
                            fontWeight: 800,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {formattedPct}
                        </Typography>
                      </Stack>
                    );
                  })}
                </Stack>
              </>
            )}
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent sx={{ p: { xs: 1.5, sm: 2 }, "&:last-child": { pb: { xs: 1.5, sm: 2 } } }}>
            <Stack direction="row" sx={{ justifyContent: "space-between", gap: 2 }}>
              <Box>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mb: 0.5 }}>
                  <BriefcaseOutlined fontSize="small" color="primary" />
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Net worth</Typography>
                </Stack>
                <Typography variant="h2" sx={{ fontSize: "1.35rem", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(totals.current_value, ccy)}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>{holdings.length} positions · capital {fmtMoney(totals.capital, ccy)}</Typography>
              </Box>
              <Stack spacing={0.75} sx={{ alignItems: "flex-end" }}>
                <PillStat label="TWR" pct={breakdown.header?.twr} />
                <PillStat label="XIRR" pct={breakdown.header?.xirr} />
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ gridColumn: { xs: "auto", sm: "1 / -1", lg: "auto" } }}>
          <CardContent sx={{ p: { xs: 1.5, sm: 2 }, "&:last-child": { pb: { xs: 1.5, sm: 2 } } }}>
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
              <MoverList title="Best 7d" items={bestSevenDay} tone="success" />
              <MoverList title="Worst 7d" items={worstSevenDay} tone="error" />
            </Box>
          </CardContent>
        </Card>
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" }, gap: 1.5 }}>
        <MetricCard label="Unrealized" value={fmtMoney(totals.current_pnl ?? 0, ccy)} meta={totals.capital > 0 ? fmtPct((totals.current_pnl ?? 0) / totals.capital, 1) : undefined} supporting={`${holdings.length} open positions`} icon={<BriefcaseOutlined fontSize="small" />} tone={(totals.current_pnl ?? 0) >= 0 ? "success" : "error"} />
        <MetricCard label="Realized" value={fmtMoney(totals.closed_pnl ?? 0, ccy)} supporting={`${data.profile?.total_roundtrips ?? 0} roundtrips`} icon={<InsightsOutlined fontSize="small" />} tone={(totals.closed_pnl ?? 0) >= 0 ? "success" : "error"} />
        <MetricCard label="Dividends" value={fmtMoney(totals.total_div ?? 0, ccy)} supporting={`${dividends?.summary?.events_count ?? 0} events`} icon={<PaidOutlined fontSize="small" />} tone="warning" />
        <MetricCard label="Total P&L" value={fmtMoney(totals.overall_pnl_div ?? 0, ccy)} meta={fmtPct(totals.overall_pnl_div_pct ?? 0, 1)} supporting="unrealized + realized + dividends" icon={(totals.overall_pnl_div ?? 0) >= 0 ? <TrendingUpRounded fontSize="small" /> : <TrendingDownRounded fontSize="small" />} tone={(totals.overall_pnl_div ?? 0) >= 0 ? "success" : "error"} />
      </Box>

      <CurrencyPnL />
      <NetWorthChart ccy={ccy} />
    </Box>
  );
}

function MoverList({ title, items, tone }: { title: string; items: any[]; tone: "success" | "error" }) {
  const Icon = tone === "success" ? ArrowUpwardRounded : ArrowDownwardRounded;
  return (
    <Box>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mb: 0.75 }}>
        <Icon fontSize="small" color={tone} />
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{title}</Typography>
      </Stack>
      <Stack spacing={0.5}>
        {items.length === 0 ? <Typography variant="body2" color="text.disabled">No data</Typography> : items.map((h: any) => (
          <Stack key={h.symbol} direction="row" sx={{ justifyContent: "space-between", gap: 1 }}>
            <Typography variant="body2" noWrap sx={{ display: { xs: "none", sm: "block" }, fontWeight: 600 }} title={h.name || h.symbol}>{h.name || h.symbol}</Typography>
            <Typography variant="body2" noWrap sx={{ display: { xs: "block", sm: "none" }, fontWeight: 700 }} title={h.name || h.symbol}>{h.symbol}</Typography>
            <Typography variant="body2" color={`${tone}.main`} sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtPct(h.change_pct_7d, 1)}</Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

function PillStat({ label, pct }: { label: string; pct: number | null | undefined }) {
  return <Chip size="small" variant="outlined" label={<><span>{label}</span> <Pct p={pct} digits={2} /></>} sx={{ fontVariantNumeric: "tabular-nums" }} />;
}

function DayInline({ pct, amount, ccy }: { pct: number | null | undefined; amount: number | null | undefined; ccy: string }) {
  const hasData = pct !== null && pct !== undefined;
  const formattedPct = hasData ? fmtPct(pct, 2) : "—";
  const good = !hasData || !((pct ?? 0) < 0 || formattedPct.startsWith("-"));
  const Arrow = good ? ArrowUpwardRounded : ArrowDownwardRounded;
  return (
    <Box>
      <Typography variant="caption" sx={{ color: "text.primary", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Today</Typography>
      {hasData ? (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline", mt: 0.5, flexWrap: "wrap" }}>
          <Arrow fontSize="small" color={good ? "success" : "error"} />
          <Typography
            variant="h2"
            sx={{
              color: good ? "success.main" : "error.main",
              fontSize: "1.35rem",
              fontWeight: 800,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formattedPct}
          </Typography>
          {amount !== null && amount !== undefined && <Typography variant="body2" sx={{ color: good ? "success.main" : "error.main", opacity: 0.78, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(amount, ccy)}</Typography>}
        </Stack>
      ) : <Typography variant="h2" color="text.disabled" sx={{ mt: 0.5 }}>—</Typography>}
    </Box>
  );
}

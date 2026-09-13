import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Box,
  Card,
  CardContent,
  Chip,
  Collapse,
  Divider,
  Dialog,
  DialogContent,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import AccountBalanceWalletOutlined from "@mui/icons-material/AccountBalanceWalletOutlined";
import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRounded from "@mui/icons-material/ArrowUpwardRounded";
import CloseRounded from "@mui/icons-material/CloseRounded";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import { alpha, useTheme } from "@mui/material/styles";
import { fmtMoney, fmtMoneyCeil, fmtPct, fmtNum, fmtDate } from "../lib/utils";
import { useHoldings } from "../hooks/usePortfolio";
import { LoadingScreen } from "../components/LoadingScreen";
import MobileTable from "../components/MobileTable";
import PageHeader from "../components/ui/PageHeader";
import MetricCard from "../components/ui/MetricCard";
import { marketLabel } from "../components/dashboard/shared";

interface Holding extends HoldingBase {
  display_mv: number;
  display_pnl: number;
  display_pnl_pct: number;
  display_total_return: number;
  total_return_pct: number;
  weight_pct: number;
  unreal_pct: number;
  real_pct: number;
  div_pct: number;
  hasPrice: boolean;
}

interface HoldingBase {
  symbol: string;
  name?: string;
  market: string;
  currency: string;
  exchange: string;
  quantity: number;
  cost_basis: number;
  avg_cost: number;
  current_price?: number | null;
  market_value?: number | null;
  market_value_base?: number | null;
  base_currency?: string;
  unrealized_pnl?: number | null;
  unrealized_pnl_pct?: number | null;
  day_change_pct?: number | null;
  day_change?: number | null;
  realized_pnl: number;
  first_acquired?: string;
  dividends_received: number;
  lots?: any[];
  label?: string;
}

type SortKey = "symbol" | "qty" | "price" | "cost" | "mktval" | "weight" | "unreal" | "real" | "divs" | "pnl";

export default function Holdings() {
  const [params] = useSearchParams();
  const focusSymbol = params.get("symbol");
  const { data: holdingsData, isLoading } = useHoldings();
  const isMobile = useMediaQuery("(max-width:767px)");
  const holdings = holdingsData?.holdings || [];
  const [filter, setFilter] = useState("");
  const [marketFilter, setMarketFilter] = useState("");
  const [selected, setSelected] = useState<HoldingBase | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("mktval");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    if (focusSymbol && holdings.length > 0) {
      const match = holdings.find((holding: HoldingBase) => holding.symbol === focusSymbol);
      if (match) setSelected(match);
    }
  }, [focusSymbol, holdings]);

  const enriched = useMemo((): Holding[] => {
    const rows = holdings.map((holding: HoldingBase) => {
      const hasPrice = holding.current_price != null;
      const marketValue = hasPrice ? (holding.market_value ?? holding.cost_basis) : holding.cost_basis;
      const unrealized = hasPrice ? (holding.unrealized_pnl ?? 0) : 0;
      const realized = holding.realized_pnl ?? 0;
      const dividends = holding.dividends_received ?? 0;
      const total = unrealized + realized + dividends;
      const unrealPct = holding.cost_basis > 0 ? unrealized / holding.cost_basis : 0;
      const realPct = holding.cost_basis > 0 ? realized / holding.cost_basis : 0;
      const divPct = holding.cost_basis > 0 ? dividends / holding.cost_basis : 0;
      const totalPct = holding.cost_basis > 0 ? total / holding.cost_basis : 0;
      return {
        ...holding,
        display_mv: marketValue,
        display_pnl: total,
        display_pnl_pct: totalPct,
        display_total_return: total,
        total_return_pct: totalPct,
        weight_pct: 0,
        unreal_pct: unrealPct,
        real_pct: realPct,
        div_pct: divPct,
        hasPrice,
      };
    });
    const totalPortfolioValue = rows.reduce(
      (sum, holding) => sum + (holding.market_value_base ?? (holding.currency === "SGD" ? holding.display_mv : 0)),
      0,
    );
    return rows.map((holding) => ({
      ...holding,
      weight_pct: totalPortfolioValue > 0
        ? (holding.market_value_base ?? (holding.currency === "SGD" ? holding.display_mv : 0)) / totalPortfolioValue
        : 0,
    }));
  }, [holdings]);

  const filtered = useMemo(() => enriched.filter((holding) => {
    if (filter && !holding.symbol.toLowerCase().includes(filter.toLowerCase())) return false;
    if (marketFilter && holding.market !== marketFilter) return false;
    return true;
  }), [enriched, filter, marketFilter]);

  const getSortVal = (holding: Holding, key: SortKey): number | string => {
    switch (key) {
      case "symbol": return holding.symbol;
      case "qty": return holding.quantity;
      case "price": return holding.current_price ?? 0;
      case "cost": return holding.cost_basis;
      case "mktval": return holding.display_mv;
      case "weight": return holding.weight_pct;
      case "unreal": return holding.unrealized_pnl ?? 0;
      case "real": return holding.realized_pnl ?? 0;
      case "divs": return holding.dividends_received ?? 0;
      case "pnl": return holding.display_pnl;
    }
  };

  const sortRows = (rows: Holding[]) => [...rows].sort((a, b) => {
    const av = getSortVal(a, sortKey);
    const bv = getSortVal(b, sortKey);
    const result = typeof av === "string" && typeof bv === "string"
      ? av.localeCompare(bv)
      : (av as number) - (bv as number);
    return sortDir === "asc" ? result : -result;
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((direction) => direction === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir(key === "symbol" ? "asc" : "desc");
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, Holding[]>();
    for (const holding of filtered) map.set(holding.currency, [...(map.get(holding.currency) || []), holding]);
    return Array.from(map.entries()).map(([ccy, rows]) => {
      const sumMv = rows.reduce((sum, row) => sum + row.display_mv, 0);
      const sumCost = rows.reduce((sum, row) => sum + row.cost_basis, 0);
      const sumUnreal = rows.reduce((sum, row) => sum + (row.unrealized_pnl ?? 0), 0);
      const sumReal = rows.reduce((sum, row) => sum + (row.realized_pnl ?? 0), 0);
      const sumDivs = rows.reduce((sum, row) => sum + (row.dividends_received ?? 0), 0);
      const sumTotal = sumUnreal + sumReal + sumDivs;
      const sumWeightPct = rows.reduce((sum, row) => sum + row.weight_pct, 0);
      return {
        ccy,
        rows,
        sumMv,
        sumCost,
        sumUnreal,
        sumReal,
        sumDivs,
        sumTotal,
        sumWeightPct,
        sumUnrealPct: sumCost > 0 ? sumUnreal / sumCost : 0,
        sumTotalPct: sumCost > 0 ? sumTotal / sumCost : 0,
      };
    }).sort((a, b) => b.sumMv - a.sumMv);
  }, [filtered]);

  const markets = Array.from(new Set(holdings.map((holding: HoldingBase) => holding.market))).sort();
  const totals = filtered.reduce((acc, holding) => ({
    marketValue: acc.marketValue + (holding.market_value_base ?? (holding.currency === "SGD" ? holding.display_mv : 0)),
    cost: acc.cost + holding.cost_basis,
    pnl: acc.pnl + holding.display_pnl,
  }), { marketValue: 0, cost: 0, pnl: 0 });

  if (isLoading) return <LoadingScreen />;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <PageHeader
        title="Holdings"
        subtitle={`${filtered.length} open positions`}
        icon={<AccountBalanceWalletOutlined />}
        actions={
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", justifyContent: { xs: "stretch", sm: "flex-end" } }}>
            <TextField value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter symbol" aria-label="Filter symbol" sx={{ minWidth: { xs: 0, sm: 180 }, flex: { xs: 1, sm: "initial" } }} />
            <TextField select value={marketFilter} onChange={(event) => setMarketFilter(event.target.value)} label="Market" sx={{ minWidth: { xs: 130, sm: 150 }, flex: { xs: 1, sm: "initial" } }}>
              <MenuItem value="">All markets</MenuItem>
              {markets.map((market) => <MenuItem key={market} value={market}>{marketLabel(market)}</MenuItem>)}
            </TextField>
          </Stack>
        }
      />

      {isMobile ? (
        <Card variant="outlined">
          <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Portfolio summary</Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1, fontVariantNumeric: "tabular-nums" }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontWeight: 700 }}>Market value</Typography>
                <Typography variant="body2" color="primary.main" sx={{ mt: 0.25, fontWeight: 700 }} noWrap>{fmtMoney(totals.marketValue, "SGD")}</Typography>
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontWeight: 700 }}>Cost basis</Typography>
                <Typography variant="body2" sx={{ mt: 0.25, fontWeight: 700 }} noWrap>{fmtMoney(totals.cost, "SGD")}</Typography>
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontWeight: 700 }}>Total P&amp;L</Typography>
                <Typography variant="body2" sx={{ mt: 0.25, color: totals.pnl >= 0 ? "success.main" : "error.main", fontWeight: 700 }} noWrap>{fmtMoney(totals.pnl, "SGD")}</Typography>
                <Typography variant="caption" sx={{ color: totals.pnl >= 0 ? "success.main" : "error.main", fontWeight: 600 }} noWrap>{totals.cost > 0 ? fmtPct(totals.pnl / totals.cost, 1) : "—"}</Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1.5 }}>
          <MetricCard label="Market value" value={fmtMoney(totals.marketValue, "SGD")} tone="primary" icon={<AccountBalanceWalletOutlined fontSize="small" />} />
          <MetricCard label="Cost basis" value={fmtMoney(totals.cost, "SGD")} tone="default" />
          <MetricCard label="Total P&L" value={fmtMoney(totals.pnl, "SGD")} meta={totals.cost > 0 ? fmtPct(totals.pnl / totals.cost, 1) : undefined} tone={totals.pnl >= 0 ? "success" : "error"} icon={totals.pnl >= 0 ? <ArrowUpwardRounded fontSize="small" /> : <ArrowDownwardRounded fontSize="small" />} />
        </Box>
      )}

      {grouped.length === 0 && <Card variant="outlined"><CardContent><Typography color="text.secondary">No holdings match the current filters.</Typography></CardContent></Card>}
      {grouped.map(({ ccy, rows, sumMv, sumCost, sumUnreal, sumReal, sumDivs, sumTotal, sumWeightPct, sumUnrealPct, sumTotalPct }) => (
        <Card key={ccy} variant="outlined" sx={{ overflow: "hidden" }}>
          <Stack direction="row" sx={{ px: { xs: 1.5, sm: 2 }, py: 1.25, alignItems: "center", justifyContent: "space-between", bgcolor: "action.hover" }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Chip size="small" label={ccy} color="primary" variant="outlined" />
              <Typography variant="caption" color="text.secondary">{rows.length} position{rows.length === 1 ? "" : "s"}</Typography>
            </Stack>
            <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(sumMv, ccy)}</Typography>
          </Stack>
          <MobileTable
            items={sortRows(rows)}
            keyOf={(holding) => holding.symbol}
            empty={`No ${ccy} positions match the current filters.`}
            renderCard={(holding) => <HoldingCard holding={holding} ccy={ccy} selected={selected?.symbol === holding.symbol} onSelect={() => setSelected(holding)} />}
            renderTable={() => (
              <TableContainer sx={{ overflowX: "auto" }}>
                <Table size="small" sx={{ minWidth: 1210, tableLayout: "fixed", "& th, & td": { overflow: "hidden" } }}>
                  <colgroup>
                    <col style={{ width: 180 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 125 }} />
                    <col style={{ width: 135 }} />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 125 }} />
                    <col style={{ width: 115 }} />
                    <col style={{ width: 115 }} />
                    <col style={{ width: 135 }} />
                  </colgroup>
                  <TableHead>
                    <TableRow>
                      <SortCell label="Position" sortKey="symbol" current={sortKey} direction={sortDir} onSort={handleSort} />
                      <SortCell label="Qty / avg" sortKey="qty" current={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                      <SortCell label="Price" sortKey="price" current={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                      <SortCell label="Cost basis" sortKey="cost" current={sortKey} direction={sortDir} onSort={handleSort} align="right" sx={{ display: { xs: "none", sm: "table-cell" } }} />
                      <SortCell label="Market value" sortKey="mktval" current={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                      <SortCell label="Weight" sortKey="weight" current={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                      <SortCell label="Unrealized" sortKey="unreal" current={sortKey} direction={sortDir} onSort={handleSort} align="right" sx={{ display: { xs: "none", md: "table-cell" } }} />
                      <SortCell label="Realized" sortKey="real" current={sortKey} direction={sortDir} onSort={handleSort} align="right" sx={{ display: { xs: "none", md: "table-cell" } }} />
                      <SortCell label="Dividends" sortKey="divs" current={sortKey} direction={sortDir} onSort={handleSort} align="right" sx={{ display: { xs: "none", md: "table-cell" } }} />
                      <SortCell label="Total P&L" sortKey="pnl" current={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sortRows(rows).map((holding) => (
                      <HoldingRow key={holding.symbol} holding={holding} ccy={ccy} selected={selected?.symbol === holding.symbol} onSelect={() => setSelected(holding)} />
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow sx={{ bgcolor: "action.hover", "& td": { fontWeight: 700 }, "& .MuiTypography-root": { fontWeight: 700 } }}>
                      <TableCell><Typography variant="body2" sx={{ fontWeight: 700 }}>Subtotal {ccy}</Typography></TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{fmtNum(rows.reduce((sum, row) => sum + row.quantity, 0), 2)}<Typography variant="caption" sx={{ display: "block" }} color="text.secondary">{rows.length} holdings</Typography></TableCell>
                      <TableCell />
                      <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" }, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(sumCost, ccy)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{fmtMoney(sumMv, ccy)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{fmtPct(sumWeightPct, 1)}</TableCell>
                      <TableCell align="right" sx={{ display: { xs: "none", md: "table-cell" }, color: sumUnreal >= 0 ? "success.main" : "error.main", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(sumUnreal, ccy)}<Typography variant="caption" sx={{ display: "block" }} color="inherit">{fmtPct(sumUnrealPct, 1)}</Typography></TableCell>
                      <TableCell align="right" sx={{ display: { xs: "none", md: "table-cell" }, color: sumReal >= 0 ? "success.main" : "error.main", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(sumReal, ccy)}</TableCell>
                      <TableCell align="right" sx={{ display: { xs: "none", md: "table-cell" }, color: "warning.main", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(sumDivs, ccy)}</TableCell>
                      <TableCell align="right" sx={{ color: sumTotal >= 0 ? "success.main" : "error.main", fontVariantNumeric: "tabular-nums" }}><Typography sx={{ fontWeight: 700 }} color="inherit">{fmtMoney(sumTotal, ccy)}</Typography><Typography variant="caption" sx={{ display: "block" }} color="inherit">{fmtPct(sumTotalPct, 1)}</Typography></TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </TableContainer>
            )}
          />
        </Card>
      ))}

      {selected && (isMobile ? (
        <Dialog open fullWidth maxWidth="sm" onClose={() => setSelected(null)} scroll="paper">
          <DialogContent sx={{ p: 1.25 }}><HoldingDetails holding={selected} onClose={() => setSelected(null)} /></DialogContent>
        </Dialog>
      ) : <HoldingDetails holding={selected} onClose={() => setSelected(null)} />)}
    </Box>
  );
}

function SortCell({ label, sortKey, current, direction, onSort, align = "left", sx }: { label: string; sortKey: SortKey; current: SortKey; direction: "asc" | "desc"; onSort?: (key: SortKey) => void; align?: "left" | "right"; sx?: any }) {
  return <TableCell align={align} sx={sx}><TableSortLabel active={current === sortKey} direction={current === sortKey ? direction : "asc"} onClick={onSort ? () => onSort(sortKey) : undefined}>{label}</TableSortLabel></TableCell>;
}

function HoldingRow({ holding, ccy, selected, onSelect }: { holding: Holding; ccy: string; selected: boolean; onSelect: () => void }) {
  const pnlColor = holding.display_pnl >= 0 ? "success.main" : "error.main";
  return (
    <TableRow hover selected={selected} onClick={onSelect} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(); }} sx={{ cursor: "pointer" }}>
      <TableCell><Typography variant="body2" sx={{ fontWeight: 700 }}>{holding.name || holding.symbol}</Typography>{holding.name && <Typography variant="caption" color="text.secondary">{holding.symbol}</Typography>}</TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{fmtNum(holding.quantity, 2)}<Typography variant="caption" sx={{ display: "block" }} color="text.secondary">avg {fmtNum(holding.avg_cost, 2)}</Typography></TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {holding.hasPrice ? fmtNum(holding.current_price, 2) : <Typography variant="caption" color="text.secondary">at cost</Typography>}
        <DailyChangeChip value={holding.day_change} pct={holding.day_change_pct} sx={{ display: "flex", width: "fit-content", ml: "auto", mt: 0.5 }} />
      </TableCell>
      <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" }, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(holding.cost_basis, ccy)}</TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmtMoney(holding.display_mv, ccy)}</TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{fmtPct(holding.weight_pct, 1)}</TableCell>
      <PnlCell value={holding.unrealized_pnl ?? 0} pct={holding.unreal_pct} ccy={ccy} sx={{ display: { xs: "none", md: "table-cell" } }} />
      <TableCell align="right" sx={{ display: { xs: "none", md: "table-cell" }, color: (holding.realized_pnl ?? 0) >= 0 ? "success.main" : "error.main", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(holding.realized_pnl ?? 0, ccy)}</TableCell>
      <TableCell align="right" sx={{ display: { xs: "none", md: "table-cell" }, color: "warning.main", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(holding.dividends_received ?? 0, ccy)}</TableCell>
      <TableCell align="right" sx={{ color: pnlColor, fontVariantNumeric: "tabular-nums" }}><Typography variant="body2" color="inherit" sx={{ fontWeight: 700 }}>{fmtMoney(holding.display_pnl, ccy)}</Typography><Typography variant="caption" color="inherit">{fmtPct(holding.total_return_pct, 1)}</Typography></TableCell>
    </TableRow>
  );
}

function PnlCell({ value, pct, ccy, sx }: { value: number; pct: number; ccy: string; sx?: any }) {
  return <TableCell align="right" sx={{ ...sx, color: value >= 0 ? "success.main" : "error.main", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(value, ccy)}<Typography variant="caption" sx={{ display: "block" }} color="inherit">{fmtPct(pct, 1)}</Typography></TableCell>;
}

function HoldingCard({ holding, ccy, selected, onSelect }: { holding: Holding; ccy: string; selected: boolean; onSelect: () => void }) {
  const isProfit = holding.display_pnl >= 0;
  const pnlColor = isProfit ? "success.main" : "error.main";
  const dayVal = holding.day_change ?? 0;
  return (
    <Card variant="outlined" onClick={onSelect} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(); }} sx={{ borderColor: selected ? "primary.main" : "divider", cursor: "pointer", boxShadow: selected ? 1 : 0 }}>
      <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start", gap: 1 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline", minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{holding.symbol}</Typography>
              <Typography variant="caption" color="primary.main" sx={{ fontWeight: 700 }}>{ccy}</Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", mt: 0.15 }}>{holding.name ? `${holding.name} · ` : ""}{marketLabel(holding.market)}</Typography>
          </Box>
          <Box sx={{ textAlign: "right", flexShrink: 0 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Market value</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtMoneyCeil(holding.display_mv, ccy)}</Typography>
            <Stack direction="row" spacing={0.75} sx={{ mt: 0.55, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", rowGap: 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmtPct(holding.weight_pct, 1)} of portfolio</Typography>
              {holding.day_change_pct == null ? (
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>Daily —</Typography>
              ) : (
                <DailyChangeChip value={dayVal} pct={holding.day_change_pct} />
              )}
            </Stack>
          </Box>
        </Stack>
        <Divider sx={{ my: 1 }} />
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1, fontVariantNumeric: "tabular-nums" }}>
          <Mini label="Qty" value={fmtNum(holding.quantity, 2)} /><Mini label="Avg" value={fmtNum(holding.avg_cost, 2)} /><Mini label="Price" value={holding.hasPrice ? fmtNum(holding.current_price, 2) : "at cost"} />
        </Box>
        <Divider sx={{ my: 1 }} />
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1 }}>
          <Mini label="Unrealized" value={fmtMoneyCeil(holding.unrealized_pnl ?? 0, ccy)} tone={(holding.unrealized_pnl ?? 0) >= 0 ? "success.main" : "error.main"} />
          <Mini label="Realized" value={fmtMoneyCeil(holding.realized_pnl ?? 0, ccy)} tone={(holding.realized_pnl ?? 0) >= 0 ? "success.main" : "error.main"} />
          <Mini label="Dividends" value={fmtMoneyCeil(holding.dividends_received ?? 0, ccy)} tone="success.main" />
        </Box>
        <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between", gap: 1, mt: 1, pt: 0.9, borderTop: 1, borderColor: "divider" }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Total P&amp;L</Typography>
          <Typography variant="body2" sx={{ color: pnlColor, fontWeight: 750, fontVariantNumeric: "tabular-nums" }} noWrap>{fmtMoneyCeil(holding.display_pnl, ccy)} ({fmtPct(holding.total_return_pct, 1)})</Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

function DailyChangeChip({ value, pct, sx }: { value?: number | null; pct?: number | null; sx?: any }) {
  const theme = useTheme();
  if (pct == null) return null;
  const isPositive = (value ?? 0) >= 0;
  const baseColor = isPositive ? theme.palette.success.main : theme.palette.error.main;
  // Make small moves subtle and large moves more prominent; pct is decimal (0.01 = 1%).
  const intensity = Math.min(Math.abs(pct) / 0.05, 1);
  const textColor = theme.palette.mode === "dark"
    ? (isPositive ? theme.palette.success.light : theme.palette.error.light)
    : (isPositive ? theme.palette.success.dark : theme.palette.error.dark);
  return (
    <Chip
      size="small"
      label={`${isPositive ? "▲" : "▼"} ${fmtPct(pct, 1)}`}
      sx={{
        ...sx,
        height: 22,
        borderRadius: 1,
        fontSize: "0.68rem",
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        color: textColor,
        backgroundColor: alpha(baseColor, 0.1 + intensity * 0.25),
        border: `1px solid ${alpha(baseColor, 0.3 + intensity * 0.45)}`,
        "& .MuiChip-label": { px: 0.8 },
      }}
    />
  );
}

function Mini({ label, value, tone = "text.primary" }: { label: string; value: ReactNode; tone?: string }) {
  return <Box sx={{ minWidth: 0 }}><Typography variant="caption" color="text.secondary" sx={{ display: "block", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.06em" }}>{label}</Typography><Typography variant="body2" color={tone} sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }} noWrap>{value}</Typography></Box>;
}

function HoldingDetails({ holding, onClose }: { holding: HoldingBase; onClose: () => void }) {
  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start", gap: 1 }}>
          <Box><Typography variant="h3">{holding.name || holding.symbol}</Typography><Typography variant="body2" color="text.secondary">{holding.symbol} · {marketLabel(holding.market)} · {holding.currency}</Typography></Box>
          <Tooltip title="Close details"><IconButton size="small" onClick={onClose}><CloseRounded fontSize="small" /></IconButton></Tooltip>
        </Stack>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }, gap: 1.5, mt: 2 }}>
          <Mini label="Quantity" value={fmtNum(holding.quantity, 2)} /><Mini label="Avg cost" value={`${fmtNum(holding.avg_cost, 2)} ${holding.currency}`} /><Mini label="Market cost" value={fmtMoney(holding.cost_basis, holding.currency)} /><Mini label="First acquired" value={fmtDate(holding.first_acquired)} /><Mini label="Realized P&L" value={fmtMoney(holding.realized_pnl, holding.currency)} /><Mini label="Dividends" value={fmtMoney(holding.dividends_received, holding.currency)} /><Mini label="Open lots" value={String(holding.lots?.length || 0)} /><Mini label="Current price" value={holding.current_price ? fmtNum(holding.current_price, 2) : "at cost"} />
        </Box>
        {holding.lots && holding.lots.length > 0 && <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Open FIFO lots</Typography>
          <TableContainer><Table size="small"><TableHead><TableRow><TableCell>Acquired</TableCell><TableCell align="right">Qty</TableCell><TableCell align="right">Price</TableCell><TableCell align="right">Cost</TableCell><TableCell align="right">Fees</TableCell></TableRow></TableHead><TableBody>{holding.lots.map((lot: any, index: number) => <TableRow key={index}><TableCell>{fmtDate(lot.acquired)}</TableCell><TableCell align="right">{fmtNum(lot.quantity, 2)}</TableCell><TableCell align="right">{fmtNum(lot.price, 2)}</TableCell><TableCell align="right">{fmtMoney(lot.cost_basis, holding.currency)}</TableCell><TableCell align="right">{fmtMoney(lot.fees, holding.currency)}</TableCell></TableRow>)}</TableBody></Table></TableContainer>
        </>}
      </CardContent>
    </Card>
  );
}

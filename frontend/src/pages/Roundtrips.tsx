import { useMemo, useState, type ReactNode } from "react";
import { Box, Button, Card, CardContent, Chip, Collapse, Divider, IconButton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import CompareArrowsOutlined from "@mui/icons-material/CompareArrowsOutlined";
import { fmtNum, fmtDate, fmtPct, ccySymbol } from "../lib/utils";
import { useRoundtrips } from "../hooks/usePortfolio";
import { LoadingScreen } from "../components/LoadingScreen";
import MobileTable from "../components/MobileTable";
import PageHeader from "../components/ui/PageHeader";
import { marketLabel } from "../components/dashboard/shared";

type Roundtrip = {
  symbol: string;
  name?: string;
  market: string;
  currency: string;
  exchange: string;
  buy_date: string;
  sell_date: string;
  quantity: number;
  original_buy_qty?: number;
  buy_price: number;
  sell_price: number;
  cost: number;
  proceeds: number;
  fees: number;
  pnl: number;
  pnl_pct: number;
  hold_days: number;
};

type SortKey = "sell_date" | "buy_date" | "pnl" | "pnl_pct" | "hold_days";

type SellLeg = {
  buy_date: string;
  buy_price: number;
  quantity: number;
  cost: number;
  pnl: number;
  pnl_pct: number;
  hold_days: number;
};

type SellGroup = {
  key: string;
  symbol: string;
  name?: string;
  market: string;
  currency: string;
  sell_date: string;
  sell_price: number;
  total_qty: number;
  total_proceeds: number;
  total_cost: number;
  total_pnl: number;
  weighted_pnl_pct: number;
  min_hold: number;
  max_hold: number;
  legs: SellLeg[];
};

// Group roundtrips by sell event (symbol + sell_date + sell_price).
// On mobile we show one card per sell event; expanding it reveals the
// individual buy legs that contributed to the sell.
function groupBySell(rows: Roundtrip[]): SellGroup[] {
  const map = new Map<string, SellGroup>();
  for (const r of rows) {
    const key = `${r.symbol}|${r.sell_date}|${r.sell_price}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        symbol: r.symbol,
        name: r.name,
        market: r.market,
        currency: r.currency,
        sell_date: r.sell_date,
        sell_price: r.sell_price,
        total_qty: 0,
        total_proceeds: 0,
        total_cost: 0,
        total_pnl: 0,
        weighted_pnl_pct: 0,
        min_hold: Infinity,
        max_hold: 0,
        legs: [],
      };
      map.set(key, g);
    }
    g.total_qty += r.quantity;
    g.total_proceeds += r.proceeds;
    g.total_cost += r.cost;
    g.total_pnl += r.pnl;
    g.legs.push({
      buy_date: r.buy_date,
      buy_price: r.buy_price,
      quantity: r.quantity,
      cost: r.cost,
      pnl: r.pnl,
      pnl_pct: r.pnl_pct,
      hold_days: r.hold_days,
    });
    if (r.hold_days < g.min_hold) g.min_hold = r.hold_days;
    if (r.hold_days > g.max_hold) g.max_hold = r.hold_days;
  }
  for (const g of map.values()) {
    g.weighted_pnl_pct = g.total_cost > 0 ? g.total_pnl / g.total_cost : 0;
    g.legs.sort((a, b) => a.buy_date.localeCompare(b.buy_date));
  }
  return Array.from(map.values()).sort((a, b) =>
    b.sell_date.localeCompare(a.sell_date),
  );
}

function formatHoldRange(min: number, max: number): string {
  if (!isFinite(min) || max === 0) return "—";
  if (min === max) return formatHoldDays(min);
  return `${formatHoldDays(min)} – ${formatHoldDays(max)}`;
}

// Pre-compute rowspan info for buy and sell groups.
// A "buy group" = consecutive rows with the same (symbol, buy_date, buy_price).
// A "sell group" = consecutive rows with the same (symbol, sell_date, sell_price).
// For the buy group quantity, prefer the original buy lot quantity (so a
// partially-consumed lot shows the full buy, not just the sold portion).
function computeGroups(rows: Roundtrip[]) {
  const buyRowSpan: number[] = new Array(rows.length).fill(1);
  const sellRowSpan: number[] = new Array(rows.length).fill(1);
  const buyGroupQty: number[] = new Array(rows.length).fill(0);
  const sellGroupQty: number[] = new Array(rows.length).fill(0);

  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (j < rows.length && rows[j].symbol === rows[i].symbol &&
           rows[j].buy_date === rows[i].buy_date &&
           rows[j].buy_price === rows[i].buy_price) j++;
    const buySpan = j - i;
    const firstLeg = rows[i];
    const totalQty = firstLeg.original_buy_qty != null
      ? firstLeg.original_buy_qty
      : rows.slice(i, j).reduce((s, r) => s + r.quantity, 0);
    buyRowSpan[i] = buySpan;
    buyGroupQty[i] = totalQty;
    for (let k = i + 1; k < j; k++) buyRowSpan[k] = 0;
    i = j;
  }

  i = 0;
  while (i < rows.length) {
    let j = i;
    while (j < rows.length && rows[j].symbol === rows[i].symbol &&
           rows[j].sell_date === rows[i].sell_date &&
           rows[j].sell_price === rows[i].sell_price) j++;
    const sellSpan = j - i;
    const totalQty = rows.slice(i, j).reduce((s, r) => s + r.quantity, 0);
    sellRowSpan[i] = sellSpan;
    sellGroupQty[i] = totalQty;
    for (let k = i + 1; k < j; k++) sellRowSpan[k] = 0;
    i = j;
  }

  return { buyRowSpan, sellRowSpan, buyGroupQty, sellGroupQty };
}

function formatHoldDays(d: number): string {
  if (d < 30) return `${d}d`;
  const months = Math.floor(d / 30);
  const remDays = d % 30;
  if (months < 12) return remDays > 0 ? `${months}mo ${remDays}d` : `${months}mo`;
  const years = Math.floor(d / 365);
  const remMonths = Math.floor((d % 365) / 30);
  return remMonths > 0 ? `${years}y ${remMonths}mo` : `${years}y`;
}

function Mini({ label, value, tone = "text.primary" }: { label: string; value: ReactNode; tone?: string }) {
  return <Box sx={{ minWidth: 0 }}>
    <Typography variant="caption" color="text.secondary" sx={{ display: "block", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.06em" }}>{label}</Typography>
    <Typography variant="body2" color={tone} sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }} noWrap>{value}</Typography>
  </Box>;
}

export default function Roundtrips() {
  const { data: rtData, isLoading } = useRoundtrips();
  const rts = rtData?.roundtrips || [];
  const [filter, setFilter] = useState("");
  const [filterType, setFilterType] = useState<"all" | "profit" | "loss">("all");
const [sortKey, setSortKey] = useState<SortKey>("sell_date");
const [sortDesc, setSortDesc] = useState(true);

  const filtered = useMemo(() => {
    let rows = [...rts];
    if (filter) {
      const q = filter.toLowerCase();
      rows = rows.filter((r) =>
        r.symbol.toLowerCase().includes(q) ||
        (r.name || "").toLowerCase().includes(q)
      );
    }
    if (filterType === "profit") rows = rows.filter((r) => r.pnl > 0);
    if (filterType === "loss") rows = rows.filter((r) => r.pnl < 0);

    // Composite sort: primary key (sortKey, sortDesc) + tie-breakers that keep
    // FIFO buy/sell groups adjacent so the merged-cell rendering stays correct.
    // The tie-breakers always sort: sell_price ASC, buy_date DESC, buy_price DESC.
    rows.sort((a, b) => {
      let av: any = a[sortKey], bv: any = b[sortKey];
      if (sortKey === "pnl" || sortKey === "pnl_pct") {
        av = parseFloat(av);
        bv = parseFloat(bv);
      }
      if (av < bv) return sortDesc ? 1 : -1;
      if (av > bv) return sortDesc ? -1 : 1;
      // tie-breakers
      if (a.sell_price < b.sell_price) return -1;
      if (a.sell_price > b.sell_price) return 1;
      if (a.buy_date > b.buy_date) return -1;
      if (a.buy_date < b.buy_date) return 1;
      if (a.buy_price > b.buy_price) return -1;
      if (a.buy_price < b.buy_price) return 1;
      return 0;
    });
    return rows;
  }, [rts, filter, filterType, sortKey, sortDesc]);

  const groups = useMemo(() => computeGroups(filtered), [filtered]);
  const sellGroups = useMemo(() => groupBySell(filtered), [filtered]);

  // Mobile expand state — tracks which sell-group cards are open.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const expandAll = () => setExpanded(new Set(sellGroups.map((g) => g.key)));
  const collapseAll = () => setExpanded(new Set());

  // Build symbol-subtotal indices for separator rows
  const symbolBreakIdx = useMemo(() => {
    const set = new Set<number>();
    for (let i = 1; i < filtered.length; i++) {
      if (filtered[i].symbol !== filtered[i - 1].symbol) set.add(i);
    }
    return set;
  }, [filtered]);

  const stats = useMemo(() => {
    const total = rts.length;
    const wins = rts.filter((r) => r.pnl > 0).length;
    const losses = rts.filter((r) => r.pnl < 0).length;
    const totalPnl = rts.reduce((s, r) => s + r.pnl, 0);
    return { total, wins, losses, totalPnl };
  }, [rts]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc((d) => !d);
    else { setSortKey(key); setSortDesc(true); }
  };

  const SortHeader = ({ label, statKey, align = "right" }: { label: string; statKey: SortKey; align?: "left" | "right" }) => (
    <TableCell align={align}>
      <TableSortLabel active={sortKey === statKey} direction={sortKey === statKey ? (sortDesc ? "desc" : "asc") : "asc"} onClick={() => handleSort(statKey)}>{label}</TableSortLabel>
    </TableCell>
  );

  if (isLoading) return <LoadingScreen />;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, minHeight: { md: "calc(100vh - 96px)" } }}>
      <PageHeader
        title="Closed positions"
        icon={<CompareArrowsOutlined />}
        subtitle={`${filtered.length} roundtrips · ${stats.wins} winners · ${stats.losses} losers`}
        actions={
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ width: { xs: "100%", sm: "auto" }, justifyContent: { xs: "stretch", sm: "flex-end" } }}>
          <TextField
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            label="Search"
            placeholder="Symbol or name"
            size="small"
            sx={{ width: { xs: "100%", sm: 220 } }}
          />
          <ToggleButtonGroup size="small" fullWidth exclusive value={filterType} onChange={(_, value) => value && setFilterType(value)} aria-label="Roundtrip result filter" sx={{ width: { xs: "100%", sm: "auto" } }}>
            <ToggleButton value="all">All</ToggleButton><ToggleButton value="profit" color="success">Profit</ToggleButton><ToggleButton value="loss" color="error">Loss</ToggleButton>
          </ToggleButtonGroup>
          </Stack>
        }
      />

      <Card variant="outlined" sx={{ overflow: "hidden", minHeight: { md: 0 }, flex: { md: 1 }, display: { md: "flex" }, flexDirection: { md: "column" } }}>
        {/* Mobile: expand/collapse all controls */}
        <Stack direction="row" sx={{ display: { xs: "flex", md: "none" }, alignItems: "center", justifyContent: "space-between", px: 1.5, py: 1, bgcolor: "action.hover", borderBottom: 1, borderColor: "divider" }}>
          <Typography variant="caption" color="text.secondary">{sellGroups.length} sell{sellGroups.length !== 1 ? "s" : ""}</Typography>
          <Stack direction="row" spacing={1}>
            {expanded.size > 0 ? (
              <Button size="small" variant="outlined" onClick={collapseAll}>Collapse all</Button>
            ) : (
              <Button size="small" variant="outlined" onClick={expandAll}>Expand all</Button>
            )}
          </Stack>
        </Stack>

        <MobileTable
          items={sellGroups}
          keyOf={(g) => g.key}
          empty="No roundtrips match the current filters."
          className="md:flex md:flex-col md:flex-1 md:min-h-0"
          tableWrapperClassName="md:flex md:flex-col md:flex-1 md:min-h-0 md:overflow-hidden"
          renderCard={(g) => {
            const isProfit = g.total_pnl >= 0;
            const sym = ccySymbol(g.currency);
            const isOpen = expanded.has(g.key);
            return (
              <Card variant="outlined" sx={{ borderColor: isOpen ? "primary.main" : "divider" }}>
                <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
                  <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start", gap: 1 }}>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline", minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{g.symbol}</Typography>
                        <Typography variant="caption" color="primary.main" sx={{ fontWeight: 700 }}>{g.currency}</Typography>
                      </Stack>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", mt: 0.15 }}>{g.name ? `${g.name} · ` : ""}{marketLabel(g.market)}</Typography>
                    </Box>
                    <Box sx={{ textAlign: "right", flexShrink: 0 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>P&amp;L</Typography>
                      <Typography variant="body1" sx={{ color: isProfit ? "success.main" : "error.main", fontWeight: 750, fontVariantNumeric: "tabular-nums" }}>{isProfit ? "+" : "−"}{sym}{fmtNum(Math.abs(g.total_pnl), 2)}</Typography>
                      <Typography variant="caption" sx={{ color: isProfit ? "success.main" : "error.main", fontVariantNumeric: "tabular-nums" }}>{fmtPct(g.weighted_pnl_pct, 1)}</Typography>
                    </Box>
                    <IconButton size="small" sx={{ minWidth: 32, minHeight: 32, flexShrink: 0 }} onClick={() => toggleExpanded(g.key)} aria-expanded={isOpen} aria-label={isOpen ? "Collapse legs" : "Expand legs"}>
                      <ExpandMoreRounded fontSize="small" sx={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 160ms" }} />
                    </IconButton>
                  </Stack>
                  <Divider sx={{ my: 1 }} />
                  <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 0.75 }}>
                    <Mini label="Closed" value={fmtDate(g.sell_date)} />
                    <Mini label="Qty" value={fmtNum(g.total_qty, 0)} />
                    <Mini label="Sell" value={`${sym}${fmtNum(g.sell_price, 2)}`} />
                    <Mini label="Held" value={formatHoldRange(g.min_hold, g.max_hold)} />
                  </Box>
                  <Stack direction="row" sx={{ justifyContent: "space-between", gap: 1, mt: 1, pt: 0.9, borderTop: 1, borderColor: "divider" }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>Cost {sym}{fmtNum(g.total_cost, 2)}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>Proceeds {sym}{fmtNum(g.total_proceeds, 2)} · {g.legs.length} leg{g.legs.length !== 1 ? "s" : ""}</Typography>
                  </Stack>
                  <Collapse in={isOpen} timeout="auto" unmountOnExit>
                    <Divider sx={{ my: 1 }} />
                    <Stack spacing={0.75}>
                      {g.legs.map((leg, i) => {
                        const legProfit = leg.pnl >= 0;
                        return (
                          <Stack key={i} direction="row" sx={{ justifyContent: "space-between", alignItems: "center", gap: 1, p: 0.75, borderRadius: 1.5, bgcolor: "action.hover" }}>
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                              <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }} noWrap>{fmtDate(leg.buy_date)} · {fmtNum(leg.quantity, 0)} sh × {sym}{fmtNum(leg.buy_price, 2)}</Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontVariantNumeric: "tabular-nums" }}>Held {formatHoldDays(leg.hold_days)}</Typography>
                            </Box>
                            <Typography variant="caption" sx={{ color: legProfit ? "success.main" : "error.main", fontWeight: 750, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{legProfit ? "+" : "−"}{sym}{fmtNum(Math.abs(leg.pnl), 0)}</Typography>
                          </Stack>
                        );
                      })}
                    </Stack>
                  </Collapse>
                </CardContent>
              </Card>
            );
          }}
          renderTable={() => (
            <TableContainer sx={{ overflow: "auto", height: "100%" }}>
              <Table stickyHeader size="small" sx={{ minWidth: 1180 }}>
                <TableHead><TableRow>
                  <TableCell>Symbol</TableCell><TableCell sx={{ display: { xs: "none", md: "table-cell" } }}>Market</TableCell>
                  <SortHeader label="Buy date" statKey="buy_date" /><TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }}>Buy price</TableCell><TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }}>Buy qty</TableCell><TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }}>Cost</TableCell>
                  <SortHeader label="Sell date" statKey="sell_date" /><TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }}>Sell price</TableCell><TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }}>Sell qty</TableCell><TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }}>Proceeds</TableCell><TableCell align="right">P&amp;L</TableCell><SortHeader label="P&amp;L %" statKey="pnl_pct" /><SortHeader label="Hold" statKey="hold_days" />
                </TableRow></TableHead>
                <TableBody>
                  {filtered.map((rt, i) => {
                    const buySpan = groups.buyRowSpan[i];
                    const sellSpan = groups.sellRowSpan[i];
                    const buyMerged = buySpan === 0;
                    const sellMerged = sellSpan === 0;
                    const buyQty = groups.buyGroupQty[i];
                    const sellQty = groups.sellGroupQty[i];
                    const isProfit = rt.pnl >= 0;
                    const sym = ccySymbol(rt.currency);
                    return (
                      <>
                        {symbolBreakIdx.has(i) && <TableRow><TableCell colSpan={13} sx={{ height: 4, p: 0, bgcolor: "divider" }} /></TableRow>}
                        <TableRow key={i} hover>
                          <TableCell><Typography variant="body2" sx={{ fontWeight: 650 }}>{rt.name || rt.symbol}</Typography>{rt.name && <Typography variant="caption" color="text.secondary">{rt.symbol}</Typography>}</TableCell>
                          <TableCell sx={{ display: { xs: "none", md: "table-cell" } }}><Chip size="small" label={rt.market} variant="outlined" /></TableCell>
                          {!buyMerged && <>
                            <TableCell rowSpan={buySpan} align="right" sx={{ color: "text.secondary", bgcolor: "action.hover", fontVariantNumeric: "tabular-nums" }}>{fmtDate(rt.buy_date)}<Typography variant="caption" sx={{ display: "block" }} color="text.secondary">×{buySpan} leg{buySpan > 1 ? "s" : ""}</Typography></TableCell>
                            <TableCell rowSpan={buySpan} align="right" sx={{ display: { xs: "none", sm: "table-cell" }, bgcolor: "action.hover", fontVariantNumeric: "tabular-nums" }}>{sym}{fmtNum(rt.buy_price, 2)}</TableCell>
                            <TableCell rowSpan={buySpan} align="right" sx={{ display: { xs: "none", sm: "table-cell" }, bgcolor: "action.hover", fontVariantNumeric: "tabular-nums" }}>{fmtNum(buyQty, 0)}<Typography variant="caption" sx={{ display: "block" }} color="text.secondary">shares</Typography></TableCell>
                          </>}
                          <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" }, fontVariantNumeric: "tabular-nums" }}>{sym}{fmtNum(rt.cost, 2)}<Typography variant="caption" sx={{ display: "block" }} color="text.secondary">{fmtNum(rt.quantity, 0)} sh</Typography></TableCell>
                          {!sellMerged && <>
                            <TableCell rowSpan={sellSpan} align="right" sx={{ color: "text.secondary", bgcolor: "action.hover", fontVariantNumeric: "tabular-nums" }}>{fmtDate(rt.sell_date)}<Typography variant="caption" sx={{ display: "block" }} color="text.secondary">×{sellSpan} leg{sellSpan > 1 ? "s" : ""}</Typography></TableCell>
                            <TableCell rowSpan={sellSpan} align="right" sx={{ display: { xs: "none", sm: "table-cell" }, bgcolor: "action.hover", fontVariantNumeric: "tabular-nums" }}>{sym}{fmtNum(rt.sell_price, 2)}</TableCell>
                            <TableCell rowSpan={sellSpan} align="right" sx={{ display: { xs: "none", sm: "table-cell" }, bgcolor: "action.hover", fontVariantNumeric: "tabular-nums" }}>{fmtNum(sellQty, 0)}<Typography variant="caption" sx={{ display: "block" }} color="text.secondary">shares</Typography></TableCell>
                          </>}
                          <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" }, fontVariantNumeric: "tabular-nums" }}>{sym}{fmtNum(rt.proceeds, 2)}<Typography variant="caption" sx={{ display: "block" }} color="text.secondary">{fmtNum(rt.quantity, 0)} sh</Typography></TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}><Typography component="span" sx={{ color: isProfit ? "success.main" : "error.main", fontWeight: 700 }}>{isProfit ? "+" : "−"}{sym}{fmtNum(Math.abs(rt.pnl), 2)}</Typography></TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}><Typography component="span" sx={{ color: isProfit ? "success.main" : "error.main" }}>{fmtPct(rt.pnl_pct, 1)}</Typography></TableCell>
                          <TableCell align="right" sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>{formatHoldDays(rt.hold_days)}</TableCell>
                        </TableRow>
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        />
      </Card>
    </Box>
  );
}

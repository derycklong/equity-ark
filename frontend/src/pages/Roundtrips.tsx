import { useMemo, useState } from "react";
import { fmtNum, fmtDate, fmtPct, ccySymbol } from "../lib/utils";
import { ArrowUpRight, ArrowDownRight, Calendar, TrendingUp, TrendingDown, ChevronDown, ChevronUp, Layers } from "lucide-react";
import { useRoundtrips } from "../hooks/usePortfolio";
import { LoadingScreen } from "../components/LoadingScreen";
import MobileTable from "../components/MobileTable";

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
    <th
      className={`${align === "right" ? "text-right" : "text-left"} px-3 py-2.5 font-medium text-sm uppercase cursor-pointer select-none hover:text-ink ${sortKey === statKey ? "text-ink" : "text-ink-faint"}`}
      onClick={() => handleSort(statKey)}
    >
      {label}
      {sortKey === statKey && (sortDesc ? " ↓" : " ↑")}
    </th>
  );

  if (isLoading) return <LoadingScreen />;

  return (
    <div className="md:flex md:flex-col md:h-[calc(100vh-4rem)]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
        <div>
          <h1 className="text-xl font-semibold">Closed positions</h1>
          <p className="text-ink-dim text-sm">
            {filtered.length} roundtrips · {stats.wins} winners · {stats.losses} losers
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2 sm:flex-wrap">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter symbol or name…"
            className="rounded-md border border-line bg-bg-card px-3 py-1.5 text-sm w-full sm:w-auto"
          />
          <div className="flex gap-1 text-sm">
            {(["all", "profit", "loss"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilterType(f)}
                className={`px-2.5 py-1 rounded capitalize ${
                  filterType === f
                    ? "bg-brand text-white"
                    : "text-ink-dim hover:text-ink bg-bg-card border border-line"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="md:flex-1 min-h-0 rounded-lg border border-line bg-bg-card overflow-hidden md:flex md:flex-col">
        {/* Mobile: expand/collapse all controls */}
        <div className="md:hidden flex items-center justify-between px-3 py-2 border-b border-line bg-bg-soft/40 text-sm">
          <span className="text-ink-faint">{sellGroups.length} sell{sellGroups.length !== 1 ? "s" : ""}</span>
          <div className="flex gap-1">
            {expanded.size > 0 ? (
              <button
                onClick={collapseAll}
                className="rounded border border-line bg-bg-card px-2 py-0.5 text-ink-dim hover:text-ink"
              >
                Collapse all
              </button>
            ) : (
              <button
                onClick={expandAll}
                className="rounded border border-line bg-bg-card px-2 py-0.5 text-ink-dim hover:text-ink"
              >
                Expand all
              </button>
            )}
          </div>
        </div>

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
            const Arrow = isProfit ? TrendingUp : TrendingDown;
            return (
              <div className={`rounded-lg border bg-bg-card overflow-hidden ${isOpen ? "border-accent/40" : "border-line"}`}>
                <button
                  type="button"
                  onClick={() => toggleExpanded(g.key)}
                  aria-expanded={isOpen}
                  className="w-full text-left p-3 active:bg-bg-soft/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-semibold truncate leading-tight">{g.name || g.symbol}</span>
                        {isOpen
                          ? <ChevronUp size={14} className="text-ink-faint shrink-0" />
                          : <ChevronDown size={14} className="text-ink-faint shrink-0" />}
                      </div>
                      {g.name && <div className="text-ink-faint text-sm tabular-nums truncate">{g.symbol}</div>}
                      <div className="text-xs text-ink-faint uppercase mt-0.5">{g.market} · {g.currency}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-sm font-semibold tabular-nums ${isProfit ? "text-good" : "text-bad"}`}>
                        {isProfit ? "▲" : "▼"} {sym} {fmtNum(Math.abs(g.total_pnl), 2)}
                      </div>
                      <div className={`text-xs tabular-nums ${isProfit ? "text-good" : "text-bad"}`}>
                        {fmtPct(g.weighted_pnl_pct, 1)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 pt-2 border-t border-line/50 flex items-center justify-between text-xs text-ink-faint">
                    <span className="flex items-center gap-1">
                      <ArrowDownRight size={11} className="text-warn" />
                      Sold {fmtNum(g.total_qty, 0)} sh × {sym}{fmtNum(g.sell_price, 2)} · {fmtDate(g.sell_date)}
                    </span>
                    <span className="flex items-center gap-2">
                      <Calendar size={11} /> {formatHoldRange(g.min_hold, g.max_hold)}
                      <span className="inline-flex items-center gap-0.5 text-ink-dim">
                        <Layers size={10} /> {g.legs.length} leg{g.legs.length !== 1 ? "s" : ""}
                      </span>
                    </span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-line/60 bg-bg-soft/30 px-2 py-1.5 space-y-1">
                    {g.legs.map((leg, i) => {
                      const legProfit = leg.pnl >= 0;
                      return (
                        <div key={i} className="flex items-center justify-between gap-2 text-sm py-1 px-1.5 rounded hover:bg-bg-card/60">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <ArrowUpRight size={10} className="text-accent shrink-0" />
                              <span className="text-xs text-ink-dim tabular-nums">{fmtDate(leg.buy_date)}</span>
                              <span className="text-ink-faint">·</span>
                              <span className="text-xs tabular-nums">{fmtNum(leg.quantity, 0)} sh</span>
                              <span className="text-ink-faint">×</span>
                              <span className="text-xs tabular-nums">{sym}{fmtNum(leg.buy_price, 2)}</span>
                            </div>
                            <div className="text-[11px] text-ink-faint mt-0.5 tabular-nums">
                              Held {formatHoldDays(leg.hold_days)} · cost {sym}{fmtNum(leg.cost, 0)}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className={`text-xs font-semibold tabular-nums ${legProfit ? "text-good" : "text-bad"}`}>
                              {legProfit ? "▲" : "▼"} {sym}{fmtNum(Math.abs(leg.pnl), 0)}
                            </div>
                            <div className={`text-[11px] tabular-nums ${legProfit ? "text-good" : "text-bad"}`}>
                              {fmtPct(leg.pnl_pct, 1)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {/* Subtotal footer inside the expanded panel */}
                    <div className="flex items-center justify-between pt-1.5 mt-1.5 border-t border-line/40 text-xs">
                      <span className="text-ink-faint">Subtotal</span>
                      <span className={`tabular-nums font-medium ${isProfit ? "text-good" : "text-bad"}`}>
                        {sym}{fmtNum(g.total_proceeds, 0)} − {sym}{fmtNum(g.total_cost, 0)} = {sym}{fmtNum(Math.abs(g.total_pnl), 0)} {g.total_pnl >= 0 ? "profit" : "loss"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          }}
          renderTable={() => (
            <div className="overflow-auto h-full md:flex-1">
              <table className="w-full text-sm">
                <thead className="text-ink-faint text-sm uppercase bg-bg-soft sticky top-0 z-10 border-b border-line">
                  <tr>
                    <th className="text-left pl-3 sm:pl-5 pr-3 sm:pr-4 py-2.5 font-medium">Symbol</th>
                    <th className="text-left px-3 py-2.5 font-medium border-l border-line hidden md:table-cell">Market</th>
                    <SortHeader label="Buy date" statKey="buy_date" align="right" />
                    <th className="text-right px-3 py-2.5 font-medium hidden sm:table-cell">Buy price</th>
                    <th className="text-right px-3 py-2.5 font-medium hidden sm:table-cell">Buy qty</th>
                    <th className="text-right px-3 py-2.5 font-medium hidden sm:table-cell">Cost</th>
                    <SortHeader label="Sell date" statKey="sell_date" align="right" />
                    <th className="text-right px-3 py-2.5 font-medium hidden sm:table-cell">Sell price</th>
                    <th className="text-right px-3 py-2.5 font-medium hidden sm:table-cell">Sell qty</th>
                    <th className="text-right px-3 py-2.5 font-medium hidden sm:table-cell">Proceeds</th>
                    <th className="text-right px-3 py-2.5 font-medium border-l border-line">P&amp;L</th>
                    <SortHeader label="P&L %" statKey="pnl_pct" />
                    <SortHeader label="Hold" statKey="hold_days" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((rt, i) => {
                    const buySpan = groups.buyRowSpan[i];
                    const sellSpan = groups.sellRowSpan[i];
                    const buyMerged = buySpan === 0;
                    const sellMerged = sellSpan === 0;
                    const buyQty = groups.buyGroupQty[i];
                    const sellQty = groups.sellGroupQty[i];
                    const isProfit = rt.pnl >= 0;
                    const showSymbolBreak = symbolBreakIdx.has(i);
                    const sym = ccySymbol(rt.currency);

                    // Subtle background tints: merged cells get a slightly darker tint to show
                    // they span multiple rows
                    const mergedBg = "bg-bg-soft";

                    return (
                      <>
                        {showSymbolBreak && (
                          <tr>
                            <td colSpan={14} className="h-1 bg-line/30" />
                          </tr>
                        )}
                        <tr
                          key={i}
                          className={`hover:bg-bg-soft/60 transition-colors border-b border-line ${i % 2 === 0 ? "" : "bg-bg-card/[0.04]"}`}
                        >
                          {/* Symbol — repeats per row but visually grouped via the break */}
                          <td className="pl-3 sm:pl-5 pr-2 sm:pr-4 py-2.5 border-r border-line max-w-[120px] sm:max-w-[180px]">
                            <div className="font-semibold leading-tight truncate">{rt.name || rt.symbol}</div>
                            {rt.name && <div className="text-ink-faint text-sm leading-tight truncate tabular-nums">{rt.symbol}</div>}
                          </td>
                          <td className="px-3 py-2.5 text-ink-faint text-sm uppercase border-r border-line whitespace-nowrap tracking-wide hidden md:table-cell">
                            {rt.market}
                          </td>

                          {/* BUY group — merged cells get subtle background + accent left border */}
                          {buyMerged ? null : (
                            <>
                              <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-ink-dim border-l-2 border-accent border-r border-line ${mergedBg}`} rowSpan={buySpan}>
                                <div className="text-sm">{fmtDate(rt.buy_date)}</div>
                                <div className="text-ink-faint text-sm">×{buySpan} leg{buySpan > 1 ? "s" : ""}</div>
                              </td>
                              <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap border-r border-line ${mergedBg} hidden sm:table-cell`} rowSpan={buySpan}>
                                <div className="text-ink-dim text-sm mb-0.5">{sym}</div>
                                <div className="font-medium">{fmtNum(rt.buy_price, 2)}</div>
                              </td>
                              <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap border-r border-line ${mergedBg} hidden sm:table-cell`} rowSpan={buySpan}>
                                <div className="font-medium">{fmtNum(buyQty, 0)}</div>
                                <div className="text-ink-faint text-sm">shares</div>
                              </td>
                            </>
                          )}

                          {/* Per-row cost */}
                          <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap border-r border-line hidden sm:table-cell">
                            <div className="text-ink-dim text-sm">{sym}</div>
                            <div>{fmtNum(rt.cost, 2)}</div>
                            <div className="text-ink-faint text-sm">({fmtNum(rt.quantity, 0)} sh)</div>
                          </td>

                          {/* SELL group */}
                          {sellMerged ? null : (
                            <>
                              <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-ink-dim border-r border-line ${mergedBg}`} rowSpan={sellSpan}>
                                <div className="text-sm">{fmtDate(rt.sell_date)}</div>
                                <div className="text-ink-faint text-sm">×{sellSpan} leg{sellSpan > 1 ? "s" : ""}</div>
                              </td>
                              <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap border-r border-line ${mergedBg} hidden sm:table-cell`} rowSpan={sellSpan}>
                                <div className="text-ink-dim text-sm mb-0.5">{sym}</div>
                                <div className="font-medium">{fmtNum(rt.sell_price, 2)}</div>
                              </td>
                              <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap border-r border-line ${mergedBg} hidden sm:table-cell`} rowSpan={sellSpan}>
                                <div className="font-medium">{fmtNum(sellQty, 0)}</div>
                                <div className="text-ink-faint text-sm">shares</div>
                              </td>
                            </>
                          )}

                          {/* Per-row proceeds */}
                          <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap border-r border-line hidden sm:table-cell">
                            <div className="text-ink-dim text-sm">{sym}</div>
                            <div>{fmtNum(rt.proceeds, 2)}</div>
                            <div className="text-ink-faint text-sm">({fmtNum(rt.quantity, 0)} sh)</div>
                          </td>

                          {/* P&L — highlighted */}
                          <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap border-l-2 ${isProfit ? "border-good bg-good/10" : "border-bad bg-bad/10"} border-r border-line font-semibold`}>
                            <div className={`flex items-center justify-end gap-1 ${isProfit ? "text-good" : "text-bad"}`}>
                              {isProfit ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                              <span>{sym} {fmtNum(Math.abs(rt.pnl), 2)}</span>
                            </div>
                          </td>
                          <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap border-r border-line ${isProfit ? "text-good" : "text-bad"}`}>
                            {fmtPct(rt.pnl_pct, 1)}
                          </td>
                          <td className="px-3 sm:px-5 py-2.5 text-right tabular-nums whitespace-nowrap text-ink-faint text-sm">
                            {formatHoldDays(rt.hold_days)}
                          </td>
                        </tr>
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        />
      </div>
    </div>
  );
}
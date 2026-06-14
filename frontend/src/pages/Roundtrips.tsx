import { useMemo, useState } from "react";
import { fmtNum, fmtDate, fmtPct, ccySymbol } from "../lib/utils";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useRoundtrips } from "../hooks/usePortfolio";
import { LoadingScreen } from "../components/LoadingScreen";

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

  const ccySym = ccySymbol("USD");

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div>
          <h1 className="text-xl font-semibold">Closed positions</h1>
          <p className="text-ink-dim text-sm">
            {filtered.length} roundtrips · {stats.wins} winners · {stats.losses} losers
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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

      <div className="flex-1 rounded-lg border border-line bg-bg-card overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1">
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
      </div>
    </div>
  );
}
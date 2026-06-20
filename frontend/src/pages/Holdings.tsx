import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { fmtMoney, fmtPct, fmtNum, fmtDate, ccySymbol } from "../lib/utils";
import { ArrowUpRight, ArrowDownRight, ArrowUp, ArrowDown } from "lucide-react";
import { useHoldings } from "../hooks/usePortfolio";
import { LoadingScreen } from "../components/LoadingScreen";
import MobileTable from "../components/MobileTable";

interface Holding extends HoldingBase {
  display_mv: number;
  display_pnl: number;
  display_pnl_pct: number;
  display_total_return: number;
  total_return_pct: number;
  unreal_pct: number;
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

export default function Holdings() {
  const [params] = useSearchParams();
  const focusSymbol = params.get("symbol");

  const { data: holdingsData, isLoading } = useHoldings();
  const holdings = holdingsData?.holdings || [];
  const [filter, setFilter] = useState<string>("");
  const [marketFilter, setMarketFilter] = useState<string>("");
  const [selected, setSelected] = useState<HoldingBase | null>(null);
  const [sortKey, setSortKey] = useState<string>("mktval");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    if (focusSymbol && holdings.length > 0) {
      const m = holdings.find((h: HoldingBase) => h.symbol === focusSymbol);
      if (m) setSelected(m);
    }
  }, [focusSymbol, holdings]);

  // Use cost basis as fallback for market value when no price is available
  const enriched = useMemo((): Holding[] => holdings.map((h) => {
    const hasPrice = h.current_price != null;
    const mv = hasPrice ? (h.market_value ?? h.cost_basis) : h.cost_basis;
    const unrealPnl = hasPrice ? (h.unrealized_pnl ?? 0) : 0;
    const realizedPnl = h.realized_pnl ?? 0;
    const divs = h.dividends_received ?? 0;
    const totalPnl = unrealPnl + realizedPnl + divs;
    const unrealPct = h.cost_basis > 0 ? unrealPnl / h.cost_basis : 0;
    const totalReturnPct = h.cost_basis > 0 ? totalPnl / h.cost_basis : 0;
    return { ...h, display_mv: mv, display_pnl: totalPnl, display_pnl_pct: totalReturnPct, display_total_return: totalPnl, total_return_pct: totalReturnPct, unreal_pct: unrealPct, hasPrice };
  }), [holdings]);

  const filtered = enriched.filter((h) => {
    if (filter && !h.symbol.toLowerCase().includes(filter.toLowerCase())) return false;
    if (marketFilter && h.market !== marketFilter) return false;
    return true;
  });

  const getSortVal = (h: Holding, key: string): number | string => {
    switch (key) {
      case "symbol": return h.symbol;
      case "market": return h.market;
      case "qty": return h.quantity;
      case "avgcost": return h.avg_cost;
      case "price": return h.current_price ?? 0;
      case "cost": return h.cost_basis;
      case "mktval": return h.display_mv;
      case "day": return h.day_change ?? 0;
      case "unreal": return h.unrealized_pnl ?? 0;
      case "real": return h.realized_pnl ?? 0;
      case "divs": return h.dividends_received ?? 0;
      case "pnl": return h.display_pnl;
      default: return 0;
    }
  };

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "symbol" || key === "market" ? "asc" : "desc");
    }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortKey !== col) return null;
    return sortDir === "asc" 
      ? <ArrowUp size={12} className="inline ml-1" />
      : <ArrowDown size={12} className="inline ml-1" />;
  };

  const sortRows = (rows: Holding[]) => {
    return [...rows].sort((a, b) => {
      const av = getSortVal(a, sortKey);
      const bv = getSortVal(b, sortKey);
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const diff = (av as number) - (bv as number);
      return sortDir === "asc" ? diff : -diff;
    });
  };

  // Group by currency
  const grouped = useMemo(() => {
    const map = new Map<string, Holding[]>();
    for (const h of enriched) {
      const list = map.get(h.currency) || [];
      list.push(h);
      map.set(h.currency, list);
    }
    return Array.from(map.entries())
      .map(([ccy, rows]) => {
        const sumMv = rows.reduce((s, r) => s + r.display_mv, 0);
        const sumCost = rows.reduce((s, r) => s + r.cost_basis, 0);
        const sumUnreal = rows.reduce((s, r) => s + (r.unrealized_pnl ?? 0), 0);
        const sumReal = rows.reduce((s, r) => s + (r.realized_pnl ?? 0), 0);
        const sumDivs = rows.reduce((s, r) => s + (r.dividends_received ?? 0), 0);
        const sumTotal = sumUnreal + sumReal + sumDivs;
        const sumUnrealPct = sumCost > 0 ? sumUnreal / sumCost : 0;
        const sumTotalPct = sumCost > 0 ? sumTotal / sumCost : 0;
        const sumDay = rows.reduce((s, r) => s + (r.day_change ?? 0), 0);
        return { ccy, rows, sumMv, sumCost, sumUnreal, sumReal, sumDivs, sumTotal, sumUnrealPct, sumTotalPct, sumDay };
      })
      .sort((a, b) => b.sumMv - a.sumMv);
  }, [enriched]);

  const markets = Array.from(new Set(holdings.map((h) => h.market))).sort();

  if (isLoading) return <LoadingScreen />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Holdings</h1>
          <p className="text-ink-dim text-sm">{filtered.length} positions · click a row to see lots</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter symbol…"
            className="rounded-md border border-line bg-bg-card px-3 py-1.5 text-sm w-full sm:w-auto"
          />
          <select
            value={marketFilter}
            onChange={(e) => setMarketFilter(e.target.value)}
            className="rounded-md border border-line bg-bg-card px-3 py-1.5 text-sm w-full sm:w-auto"
          >
            <option value="">All markets</option>
            {markets.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {grouped.map(({ ccy, rows, sumMv, sumCost, sumUnreal, sumReal, sumDivs, sumTotal, sumUnrealPct, sumTotalPct, sumDay }) => (
        <div key={ccy} className="rounded-lg border border-line bg-bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-bg-soft border-b border-line">
            <span className="text-sm font-semibold">{ccy}</span>
            <span className="text-sm text-ink-faint">{rows.length} position{rows.length !== 1 ? "s" : ""}</span>
          </div>
          <MobileTable
            items={sortRows(rows)}
            keyOf={(h) => h.symbol}
            empty={`No ${ccy} positions match the current filters.`}
            renderCard={(h) => (
              <div
                onClick={() => setSelected(h)}
                className={`rounded-lg border border-line bg-bg-card p-3 active:scale-[0.99] transition-transform cursor-pointer ${selected?.symbol === h.symbol ? "ring-1 ring-accent" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate leading-tight">{h.name || h.symbol}</div>
                    {h.name && <div className="text-ink-faint text-sm tabular-nums truncate">{h.symbol}</div>}
                    <div className="text-xs text-ink-faint uppercase mt-0.5">{h.market} · {h.currency}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-medium tabular-nums">{fmtMoney(h.display_mv, ccy)}</div>
                    <div className="text-xs text-ink-faint tabular-nums">Mkt val</div>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                  <Mini2 label="Qty" value={fmtNum(h.quantity, 2)} />
                  <Mini2 label="Avg cost" value={`${ccySymbol(h.currency)} ${fmtNum(h.avg_cost, 2)}`} />
                  <Mini2 label="Price" value={h.hasPrice ? fmtNum(h.current_price!, 2) : "at cost"} muted={!h.hasPrice} />
                  <Mini2
                    label="Day"
                    value={
                      <span className={(h.day_change ?? 0) >= 0 ? "text-good" : "text-bad"}>
                        {fmtMoney(h.day_change ?? 0, ccy)}{" "}
                        <span className="text-xs">({fmtPct(h.day_change_pct ?? 0, 2)})</span>
                      </span>
                    }
                  />
                </div>
                <div className="mt-2 pt-2 border-t border-line/50 flex items-baseline justify-between">
                  <span className="text-xs text-ink-faint">Total P&L (incl. divs)</span>
                  <span className={`text-sm font-semibold tabular-nums ${h.display_pnl >= 0 ? "text-good" : "text-bad"}`}>
                    {h.display_pnl >= 0 ? <ArrowUpRight size={12} className="inline" /> : <ArrowDownRight size={12} className="inline" />}
                    {" "}{fmtMoney(h.display_pnl, ccy)}{" "}
                    <span className="text-xs font-normal">({fmtPct(h.total_return_pct, 1)})</span>
                  </span>
                </div>
              </div>
            )}
            renderTable={() => (
              <div className="overflow-x-auto">
                <table className="w-full text-sm table-fixed">
                  <colgroup>
                    <col style={{ width: "140px" }} />
                    <col className="hidden sm:table-column" style={{ width: "50px" }} />
                    <col style={{ width: "90px" }} />
                    <col style={{ width: "70px" }} />
                    <col className="hidden sm:table-column" style={{ width: "100px" }} />
                    <col style={{ width: "100px" }} />
                    <col className="hidden md:table-column" style={{ width: "100px" }} />
                    <col className="hidden md:table-column" style={{ width: "100px" }} />
                    <col className="hidden md:table-column" style={{ width: "80px" }} />
                    <col className="hidden md:table-column" style={{ width: "80px" }} />
                    <col style={{ width: "110px" }} />
                  </colgroup>
                  <thead className="text-ink-faint text-sm uppercase bg-bg-soft">
                    <tr>
                      <th className="text-left px-3 sm:px-4 py-2 whitespace-nowrap cursor-pointer hover:text-ink select-none" onClick={() => handleSort("symbol")}>Symbol<SortIcon col="symbol" /></th>
                      <th className="text-left px-2 py-2 whitespace-nowrap cursor-pointer hover:text-ink select-none hidden sm:table-cell" onClick={() => handleSort("market")}>Market<SortIcon col="market" /></th>
                      <th className="text-right px-2 py-2 whitespace-nowrap cursor-pointer hover:text-ink select-none" onClick={() => handleSort("qty")}>Qty<br/>Avg cost<SortIcon col="qty" /></th>
                      <th className="text-right px-2 py-2 whitespace-nowrap cursor-pointer hover:text-ink select-none" onClick={() => handleSort("price")}>Price<SortIcon col="price" /></th>
                      <th className="text-right px-2 py-2 whitespace-nowrap cursor-pointer hover:text-ink select-none hidden sm:table-cell" onClick={() => handleSort("cost")}>Cost basis<SortIcon col="cost" /></th>
                      <th className="text-right px-2 py-2 whitespace-nowrap cursor-pointer hover:text-ink select-none" onClick={() => handleSort("mktval")}>Mkt val<SortIcon col="mktval" /></th>
                      <th className="text-right px-2 py-2 whitespace-nowrap cursor-pointer hover:text-ink select-none border-l border-line hidden md:table-cell" onClick={() => handleSort("day")}>Day<SortIcon col="day" /></th>
                      <th className="text-right px-2 py-2 whitespace-nowrap cursor-pointer hover:text-ink select-none hidden md:table-cell" onClick={() => handleSort("unreal")}>Unrealized<SortIcon col="unreal" /></th>
                      <th className="text-right px-2 py-2 whitespace-nowrap cursor-pointer hover:text-ink select-none hidden md:table-cell" onClick={() => handleSort("real")}>Realized<SortIcon col="real" /></th>
                      <th className="text-right px-2 py-2 whitespace-nowrap cursor-pointer hover:text-ink select-none hidden md:table-cell" onClick={() => handleSort("divs")}>Dividends<SortIcon col="divs" /></th>
                      <th className="text-right px-3 sm:px-4 py-2 whitespace-nowrap cursor-pointer hover:text-ink select-none border-l border-line" onClick={() => handleSort("pnl")}>Total P&L<SortIcon col="pnl" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortRows(rows).map((h) => (
                      <tr
                        key={h.symbol}
                        onClick={() => setSelected(h)}
                        className={`border-t border-line cursor-pointer hover:bg-bg-soft ${selected?.symbol === h.symbol ? "bg-bg-soft" : ""}`}
                      >
                        <td className="px-3 sm:px-4 py-2 overflow-hidden">
                          <div className="font-medium leading-tight truncate">{h.name || h.symbol}</div>
                          {h.name && <div className="text-ink-faint text-sm leading-tight truncate tabular-nums">{h.symbol}</div>}
                        </td>
                        <td className="px-2 py-2 text-ink-faint text-sm uppercase truncate hidden sm:table-cell">{h.market}</td>
                        <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                          <div>{fmtNum(h.quantity, 2)}</div>
                          <div className="text-ink-faint text-sm">{fmtNum(h.avg_cost, 2)}</div>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{h.hasPrice ? fmtNum(h.current_price!, 2) : <span className="text-ink-faint">at cost</span>}</td>
                        <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap hidden sm:table-cell">{fmtMoney(h.cost_basis, ccy)}</td>
                        <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{fmtMoney(h.display_mv, ccy)}</td>
                        <td className={`px-2 py-2 text-right tabular-nums whitespace-nowrap border-l border-line hidden md:table-cell ${(h.day_change ?? 0) >= 0 ? "text-good" : "text-bad"}`}>
                          <div>{fmtMoney(h.day_change ?? 0, ccy)}</div>
                          <div className="text-sm">{fmtPct(h.day_change_pct ?? 0, 2)}</div>
                        </td>
                        <td className={`px-2 py-2 text-right tabular-nums whitespace-nowrap hidden md:table-cell ${(h.unrealized_pnl ?? 0) >= 0 ? "text-good" : "text-bad"}`}>
                          <div>{fmtMoney(h.unrealized_pnl ?? 0, ccy)}</div>
                          <div className="text-sm">{fmtPct(h.unreal_pct ?? 0, 1)}</div>
                        </td>
                        <td className={`px-2 py-2 text-right tabular-nums whitespace-nowrap hidden md:table-cell ${(h.realized_pnl ?? 0) >= 0 ? "text-good" : "text-bad"}`}>
                          {fmtMoney(h.realized_pnl ?? 0, ccy)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap text-warn hidden md:table-cell">
                          {fmtMoney(h.dividends_received ?? 0, ccy)}
                        </td>
                        <td className={`px-3 sm:px-4 py-2 text-right tabular-nums whitespace-nowrap border-l border-line ${h.display_pnl >= 0 ? "text-good" : "text-bad"}`}>
                          <div className="font-medium">
                            {h.display_pnl >= 0 ? <ArrowUpRight size={12} className="inline" /> : <ArrowDownRight size={12} className="inline" />}
                            {" "}{fmtMoney(h.display_pnl, ccy)}
                          </div>
                          <div className="text-sm">{fmtPct(h.total_return_pct, 1)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-line bg-bg-soft font-semibold">
                      <td className="px-3 sm:px-4 py-2">Subtotal {ccy}</td>
                      <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap hidden sm:table-cell"></td>
                      <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                        <div>{fmtNum(rows.reduce((s, r) => s + r.quantity, 0), 2)}</div>
                        <div className="text-ink-faint text-sm">{sumCost > 0 && rows.reduce((s, r) => s + r.quantity, 0) > 0 ? fmtNum(sumCost / rows.reduce((s, r) => s + r.quantity, 0), 2) : ""}</div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap"></td>
                      <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap hidden sm:table-cell">{fmtMoney(sumCost, ccy)}</td>
                      <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{fmtMoney(sumMv, ccy)}</td>
                      <td className={`px-2 py-2 text-right tabular-nums whitespace-nowrap border-l border-line hidden md:table-cell ${sumDay >= 0 ? "text-good" : "text-bad"}`}>
                        <div>{fmtMoney(sumDay, ccy)}</div>
                        <div className="text-sm">{fmtPct(sumMv > 0 ? sumDay / (sumMv - sumDay) : 0, 2)}</div>
                      </td>
                      <td className={`px-2 py-2 text-right tabular-nums whitespace-nowrap border-l border-line hidden md:table-cell ${sumUnreal >= 0 ? "text-good" : "text-bad"}`}>
                        <div>{fmtMoney(sumUnreal, ccy)}</div>
                        <div className="text-sm">{fmtPct(sumUnrealPct, 1)}</div>
                      </td>
                      <td className={`px-2 py-2 text-right tabular-nums whitespace-nowrap hidden md:table-cell ${sumReal >= 0 ? "text-good" : "text-bad"}`}>
                        {fmtMoney(sumReal, ccy)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap text-warn hidden md:table-cell">
                        {fmtMoney(sumDivs, ccy)}
                      </td>
                      <td className={`px-3 sm:px-4 py-2 text-right tabular-nums whitespace-nowrap border-l border-line ${sumTotal >= 0 ? "text-good" : "text-bad"}`}>
                        <div className="font-medium">
                          {sumTotal >= 0 ? <ArrowUpRight size={12} className="inline" /> : <ArrowDownRight size={12} className="inline" />}
                          {" "}{fmtMoney(sumTotal, ccy)}
                        </div>
                        <div className="text-sm">{fmtPct(sumTotalPct, 1)}</div>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          />
        </div>
      ))}

      {selected && (
        <div className="rounded-lg border border-line bg-bg-card p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold">{selected.symbol}
              <span className="text-ink-faint text-sm ml-2 uppercase">{selected.market} · {selected.currency}</span>
            </h2>
            <div className="text-ink-faint text-sm -mt-2 mb-3">{selected.name || ""}</div>
            <button onClick={() => setSelected(null)} className="text-sm text-ink-faint hover:text-ink">Close</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
            <Stat label="Quantity" value={fmtNum(selected.quantity, 2)} />
            <Stat label="Avg cost" value={`${fmtNum(selected.avg_cost, 2)} ${selected.currency}`} />
            <Stat label="Mkt Cost" value={fmtMoney(selected.cost_basis, selected.currency)} />
            <Stat label="First acquired" value={fmtDate(selected.first_acquired)} />
            <Stat label="Realized P&L" value={fmtMoney(selected.realized_pnl, selected.currency)} />
            <Stat label="Dividends" value={fmtMoney(selected.dividends_received, selected.currency)} />
            <Stat label="Open lots" value={String(selected.lots?.length || 0)} />
            <Stat label="Current price" value={selected.current_price ? fmtNum(selected.current_price, 2) : "at cost"} />
          </div>
          {selected.lots && selected.lots.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">Open FIFO lots</h3>
              <table className="w-full text-sm">
                <thead className="text-ink-faint text-sm uppercase">
                  <tr>
                    <th className="text-left py-1.5">Acquired</th>
                    <th className="text-right py-1.5">Qty</th>
                    <th className="text-right py-1.5">Price</th>
                    <th className="text-right py-1.5">Cost</th>
                    <th className="text-right py-1.5">Fees</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.lots.map((l: any, i: number) => (
                    <tr key={i} className="border-t border-line">
                      <td className="py-1.5">{fmtDate(l.acquired)}</td>
                      <td className="text-right tabular-nums">{fmtNum(l.quantity, 2)}</td>
                      <td className="text-right tabular-nums">{fmtNum(l.price, 2)}</td>
                      <td className="text-right tabular-nums">{fmtMoney(l.cost_basis, selected.currency)}</td>
                      <td className="text-right tabular-nums">{fmtMoney(l.fees, selected.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm text-ink-faint">{label}</div>
      <div className="text-sm tabular-nums">{value}</div>
    </div>
  );
}

function Mini2({ label, value, muted }: { label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-ink-faint leading-tight">{label}</div>
      <div className={`text-sm tabular-nums truncate leading-tight ${muted ? "text-ink-faint" : ""}`}>{value}</div>
    </div>
  );
}

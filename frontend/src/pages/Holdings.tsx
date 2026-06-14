import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { fmtMoney, fmtPct, fmtNum, fmtDate } from "../lib/utils";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useHoldings } from "../hooks/usePortfolio";
import { LoadingScreen } from "../components/LoadingScreen";

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

  // Group by currency
  const grouped = useMemo(() => {
    const map = new Map<string, Holding[]>();
    for (const h of enriched) {
      const list = map.get(h.currency) || [];
      list.push(h);
      map.set(h.currency, list);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
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
      });
  }, [enriched]);

  const markets = Array.from(new Set(holdings.map((h) => h.market))).sort();

  if (isLoading) return <LoadingScreen />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">Holdings</h1>
          <p className="text-ink-dim text-sm">{filtered.length} positions · click a row to see lots</p>
        </div>
        <div className="flex gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter symbol…"
            className="rounded-md border border-line bg-bg-card px-3 py-1.5 text-sm"
          />
          <select
            value={marketFilter}
            onChange={(e) => setMarketFilter(e.target.value)}
            className="rounded-md border border-line bg-bg-card px-3 py-1.5 text-sm"
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
                  <th className="text-left px-3 sm:px-4 py-2 whitespace-nowrap">Symbol</th>
                  <th className="text-left px-2 py-2 whitespace-nowrap hidden sm:table-cell">Market</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap">Qty<br/>Avg cost</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap">Price</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap hidden sm:table-cell">Cost basis</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap">Mkt val</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap border-l border-line hidden md:table-cell">Day</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap hidden md:table-cell">Unrealized</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap hidden md:table-cell">Realized</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap hidden md:table-cell">Dividends</th>
                  <th className="text-right px-3 sm:px-4 py-2 whitespace-nowrap border-l border-line">Total P&L</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => (
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

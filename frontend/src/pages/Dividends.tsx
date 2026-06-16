import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { fmtDate, ccySymbol, fmtMoneyFull, fmtPct, fmtNum } from "../lib/utils";
import { Coins, Building2, ArrowUpRight, ArrowDownRight, RefreshCw, ChevronDown, ChevronUp, BarChart3, Calendar, Wallet, TrendingUp, ListChecks } from "lucide-react";
import { useDividends, useHoldings, useInvalidateAll } from "../hooks/usePortfolio";
import { LoadingScreen } from "../components/LoadingScreen";
import MobileTable from "../components/MobileTable";

const BASE_CCY = "SGD";

const CCY_COLORS: Record<string, string> = {
  SGD: "bg-warn",
  USD: "bg-accent",
  HKD: "bg-good",
  GBP: "bg-bad",
  CNY: "bg-info",
};

function colorForCcy(ccy: string) {
  return CCY_COLORS[ccy] || "bg-ink-faint";
}

type CardId = "kpi" | "monthly" | "yearly" | "payers" | "currency";

export default function Dividends() {
  const invalidateAll = useInvalidateAll();
  const { data: divData, isLoading } = useDividends();
  const { data: holdingsData } = useHoldings();
  const [ccyFilter, setCcyFilter] = useState<string>("ALL");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  // Default the snapshot card open.
  const [openCard, setOpenCard] = useState<CardId | "">("kpi");

  const toggleCard = (id: CardId) => {
    setOpenCard((curr) => (curr === id ? "" : id) as CardId);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const r = await api.cacheRefresh();
      setRefreshMsg(
        `Refreshed prices (${r.prices_updated}) + dividends (${r.dividends_refreshed} symbols · ${r.dividend_events} events)`,
      );
      invalidateAll();
    } catch (e: any) {
      setRefreshMsg(`Refresh failed: ${e?.message || e}`);
    } finally {
      setRefreshing(false);
      setTimeout(() => setRefreshMsg(null), 4000);
    }
  };

  const data = divData;
  const events = data?.events || [];
  const summary = data?.summary || {};
  const totalSgd = summary.total_received_base || 0;
  const bySymbol = summary.by_symbol || [];

  // Holdings → symbol→{market_value_native, dividends_native, currency, name}
  const holdingsBySym = useMemo(() => {
    const m: Record<string, { market_value: number; dividends_received: number; currency: string; name: string }> = {};
    for (const h of holdingsData?.holdings || []) {
      m[h.symbol.toUpperCase()] = {
        market_value: h.market_value || 0,
        dividends_received: h.dividends_received || 0,
        currency: h.currency,
        name: h.name || "",
      };
    }
    return m;
  }, [holdingsData]);

  // Last full year's dividends per symbol (in native currency, for yield calc)
  const lastFullYear = (() => {
    const now = new Date();
    if (now.getMonth() === 0) return String(now.getFullYear() - 2);
    return String(now.getFullYear() - 1);
  })();
  const lastYearDivsBySym = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of events) {
      const y = (e.ex_date || "").slice(0, 4);
      if (y !== lastFullYear) continue;
      m[e.symbol.toUpperCase()] = (m[e.symbol.toUpperCase()] || 0) + (e.total_received || 0);
    }
    return m;
  }, [events, lastFullYear]);

  // Currencies present, sorted by total native descending
  const ccys = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of events) m[e.currency] = (m[e.currency] || 0) + (e.total_received || 0);
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => c);
  }, [events]);

  // All years across all currencies
  const allYears = useMemo(() => {
    const s = new Set<string>();
    for (const e of events) {
      const y = (e.ex_date || "").slice(0, 4);
      if (y) s.add(y);
    }
    return Array.from(s).sort();
  }, [events]);

  const yearTotalsSgd = summary.by_year_base || {};
  const maxYearSgd = Math.max(...Object.values(yearTotalsSgd).map((v) => Number(v)), 1);

  // Per-currency per-year for the stacked bar
  const byYearCcySgd = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const e of events) {
      const y = (e.ex_date || "").slice(0, 4);
      if (!y) continue;
      if (!m[y]) m[y] = {};
      m[y][e.currency] = (m[y][e.currency] || 0) + (e.total_received || 0);
    }
    const out: Record<string, Record<string, number>> = {};
    for (const [y, byCcy] of Object.entries(m)) {
      const nativeTotal = Object.values(byCcy).reduce((a, b) => a + b, 0);
      const sgdTotal = Number(yearTotalsSgd[y] || 0);
      const rate = nativeTotal > 0 ? sgdTotal / nativeTotal : 0;
      out[y] = {};
      for (const [c, v] of Object.entries(byCcy)) {
        out[y][c] = v * rate;
      }
    }
    return out;
  }, [events, yearTotalsSgd]);

  // Per-currency-per-year conversion rate to SGD
  const yearCcyRates = useMemo(() => {
    const byYearCcy = (summary.by_year_by_ccy || {}) as Record<string, Record<string, number>>;
    const out: Record<string, Record<string, number>> = {};
    for (const [y, byCcy] of Object.entries(byYearCcy)) {
      const sgdTotal = Number(yearTotalsSgd[y] || 0);
      const ccyList = Object.keys(byCcy);
      if (ccyList.length === 1) {
        const c = ccyList[0];
        const native = Number(byCcy[c]);
        out[y] = { [c]: native > 0 ? sgdTotal / native : 0 };
      } else {
        const sgdNative = Number(byCcy["SGD"] || 0);
        const sgdEquivForOthers = sgdTotal - sgdNative;
        out[y] = { SGD: 1.0 };
        for (const [c, native] of Object.entries(byCcy)) {
          if (c === "SGD") continue;
          const n = Number(native);
          out[y][c] = n > 0 ? sgdEquivForOthers / n : 0;
        }
      }
    }
    return out;
  }, [summary, yearTotalsSgd]);

  const rateOf = (e: any) => {
    const y = (e.ex_date || "").slice(0, 4);
    return yearCcyRates[y]?.[e.currency] ?? 0;
  };

  const monthlySgd = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of events) {
      const d = new Date(e.ex_date);
      if (isNaN(d.getTime())) continue;
      const y = String(d.getFullYear());
      const k = `${y}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      m[k] = (m[k] || 0) + (e.total_received || 0) * (rateOf(e) || 0);
    }
    return m;
  }, [events, yearCcyRates]);

  const monthlySorted = useMemo(
    () => Object.entries(monthlySgd).sort(([a], [b]) => a.localeCompare(b)),
    [monthlySgd],
  );
  const last12Months = monthlySorted.slice(-12);
  const maxMonthSgd = Math.max(...last12Months.map(([, v]) => v), 1);

  // YoY comparison — YTD vs same period last year (month-by-month)
  const currentYear = new Date().getFullYear().toString();
  const lastYear = (new Date().getFullYear() - 1).toString();
  const currentMonth = new Date().getMonth();
  const ytdSgd = Number(yearTotalsSgd[currentYear] || 0);
  const lastYtdSgd = monthlySorted
    .filter(([k]) => k.startsWith(lastYear + "-"))
    .filter(([k]) => Number(k.slice(5, 7)) - 1 <= currentMonth)
    .reduce((s, [, v]) => s + v, 0);
  const yoyChange = lastYtdSgd > 0 ? (ytdSgd - lastYtdSgd) / lastYtdSgd : 0;

  // Symbol → name lookup
  const nameBySym = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of events) {
      if (e.name && !m[e.symbol.toUpperCase()]) m[e.symbol.toUpperCase()] = e.name;
    }
    for (const [sym, h] of Object.entries(holdingsBySym)) {
      if (h.name && !m[sym]) m[sym] = h.name;
    }
    return m;
  }, [events, holdingsBySym]);

  const bySymbolWithName = useMemo(() => {
    return bySymbol.map((s: any) => ({
      ...s,
      name: s.name || nameBySym[s.symbol.toUpperCase()] || "",
    }));
  }, [bySymbol, nameBySym]);

  const topPayer = useMemo(() => {
    if (!bySymbolWithName.length) return null;
    const withYield = bySymbolWithName.map((s: any) => {
      const sym = s.symbol.toUpperCase();
      const h = holdingsBySym[sym];
      const annualDivs = lastYearDivsBySym[sym] ?? 0;
      const yieldPct = h && h.market_value > 0 ? annualDivs / h.market_value : 0;
      return { ...s, yieldPct, annualDivs };
    });
    const hasYield = withYield.some((s: any) => s.yieldPct > 0);
    if (!hasYield) return bySymbolWithName[0];
    return withYield.sort((a: any, b: any) => b.yieldPct - a.yieldPct)[0];
  }, [bySymbolWithName, holdingsBySym, lastYearDivsBySym]);
  const topPayerPct = topPayer?.yieldPct ?? 0;

  const perCcyBySymbol = useMemo(() => {
    const m: Record<string, Record<string, { total: number; events: number; name: string; totalSgd: number }>> = {};
    for (const e of events) {
      const ccy = e.currency;
      const sym = e.symbol;
      if (!m[ccy]) m[ccy] = {};
      if (!m[ccy][sym]) m[ccy][sym] = { total: 0, events: 0, name: e.name || "", totalSgd: 0 };
      m[ccy][sym].total += e.total_received || 0;
      m[ccy][sym].totalSgd += (e.total_received || 0) * (rateOf(e) || 0);
      m[ccy][sym].events += 1;
      if (!m[ccy][sym].name && e.name) m[ccy][sym].name = e.name;
    }
    return m;
  }, [events, yearCcyRates]);

  const filteredEvents = useMemo(
    () => (ccyFilter === "ALL" ? events : events.filter((e: any) => e.currency === ccyFilter)),
    [events, ccyFilter],
  );

  if (isLoading) return <LoadingScreen />;
  if (!data) return <div>No data</div>;

  return (
    <div className="space-y-3 lg:flex lg:flex-col lg:h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Coins size={18} className="text-warn" />
          Dividends
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-ink-faint">
            {summary.events_count} events · {bySymbol.length} payers · {ccys.length} currenc{ccys.length !== 1 ? "ies" : "y"}
          </span>
          {refreshMsg && <span className="text-sm text-ink-faint">{refreshMsg}</span>}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1 px-2 py-1 rounded text-sm text-ink-dim hover:text-ink hover:bg-bg-soft disabled:opacity-50"
            title="Re-fetch dividend history from yfinance for all held symbols"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* === Mobile: transactions only (full width) === */}
      {/* === Desktop: 2-column layout: Left = transactions, Right = accordion cards === */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-3 lg:flex-1 lg:min-h-0">
        {/* LEFT — All dividend transactions */}
        <div className="rounded-lg border border-line bg-bg-card overflow-hidden lg:row-span-1 flex flex-col">
          <div className="px-3 py-2 border-b border-line flex items-center justify-between gap-2 bg-bg-soft shrink-0">
            <h2 className="text-sm font-medium shrink-0 flex items-center gap-1.5">
              <ListChecks size={13} className="text-warn" />
              All dividend transactions
            </h2>
            <div className="flex items-center gap-1 text-sm overflow-x-auto whitespace-nowrap">
              <button
                onClick={() => setCcyFilter("ALL")}
                className={`shrink-0 px-2 py-0.5 rounded ${ccyFilter === "ALL" ? "bg-warn text-bg font-medium" : "text-ink-dim hover:text-ink hover:bg-bg-card"}`}
              >
                All ({events.length})
              </button>
              {ccys.map((c) => {
                const count = events.filter((e: any) => e.currency === c).length;
                return (
                  <button
                    key={c}
                    onClick={() => setCcyFilter(c)}
                    className={`shrink-0 px-2 py-0.5 rounded ${ccyFilter === c ? "bg-warn text-bg font-medium" : "text-ink-dim hover:text-ink hover:bg-bg-card"}`}
                  >
                    {c} ({count})
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            <MobileTable
              items={filteredEvents}
              keyOf={(e: any, i: number) => `${e.symbol}-${e.ex_date}-${i}`}
              empty="No dividend events"
              renderCard={(e: any) => (
                <div className="rounded-lg border border-line bg-bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate leading-tight">{e.name || e.symbol}</div>
                      {e.name && <div className="text-ink-faint text-sm tabular-nums truncate">{e.symbol}</div>}
                      <div className="text-xs text-ink-faint tabular-nums mt-0.5">
                        {fmtDate(e.ex_date)} · {e.currency}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold tabular-nums text-warn">
                        {ccySymbol(e.currency)}{e.total_received.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className="text-xs tabular-nums text-ink-faint mt-0.5">
                        = {fmtMoneyFull((e.total_received || 0) * (rateOf(e) || 0), BASE_CCY)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-line/50 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-ink-faint leading-tight">Shares</div>
                      <div className="text-sm tabular-nums leading-tight">
                        {e.shares_at_ex.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-ink-faint leading-tight">Per share</div>
                      <div className="text-sm tabular-nums leading-tight text-ink-dim">
                        {ccySymbol(e.currency)}{e.amount_per_share.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              renderTable={() => (
                <table className="w-full text-sm">
                  <thead className="text-ink-faint text-sm uppercase sticky top-0 bg-bg-card border-b border-line">
                    <tr>
                      <th className="text-left px-3 py-1.5 font-medium">Ex-date</th>
                      <th className="text-left px-2 py-1.5 font-medium">Symbol</th>
                      <th className="text-right px-2 py-1.5 font-medium hidden sm:table-cell">Shares</th>
                      <th className="text-right px-2 py-1.5 font-medium hidden sm:table-cell">Per share</th>
                      <th className="text-right px-2 py-1.5 font-medium">Received</th>
                      <th className="text-right px-3 py-1.5 font-medium">In {BASE_CCY}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEvents.map((e: any, i: number) => (
                      <tr key={`${e.symbol}-${e.ex_date}-${i}`} className="border-t border-line/50 hover:bg-bg-soft">
                        <td className="px-3 py-1.5 text-ink-dim tabular-nums whitespace-nowrap">{fmtDate(e.ex_date)}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <div className="text-sm font-medium leading-tight">{e.name || e.symbol}</div>
                          {e.name && <div className="text-ink-faint text-sm leading-tight tabular-nums">{e.symbol}</div>}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap hidden sm:table-cell">
                          {e.shares_at_ex.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-ink-dim whitespace-nowrap hidden sm:table-cell">
                          {ccySymbol(e.currency)}{e.amount_per_share.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-warn whitespace-nowrap">
                          {ccySymbol(e.currency)}{e.total_received.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap font-medium">
                          {fmtMoneyFull((e.total_received || 0) * (rateOf(e) || 0), BASE_CCY)}
                        </td>
                      </tr>
                    ))}
                    {filteredEvents.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-ink-faint text-sm">
                          No dividend events
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            />
          </div>
        </div>

        {/* RIGHT — Accordion cards (desktop only).
            Sticky so it stays in view as the left table scrolls internally,
            and `self-start` so the column doesn't stretch to fill the grid
            track (which would visually stretch the Snapshot card). */}
        <div className="hidden lg:block lg:self-start lg:sticky lg:top-4 space-y-2">
          {/* Card 1: KPI snapshot */}
          <AccordionCard
            id="kpi"
            title="Snapshot"
            icon={<BarChart3 size={13} className="text-warn" />}
            open={openCard === "kpi"}
            onToggle={() => toggleCard("kpi")}
          >
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-line bg-bg-soft/50 px-3 py-2">
                <div className="text-xs uppercase tracking-wide text-ink-faint">Lifetime</div>
                <div className="text-lg font-semibold text-warn tabular-nums leading-tight mt-0.5">{fmtMoneyFull(totalSgd, BASE_CCY)}</div>
              </div>
              <div className="rounded-md border border-line bg-bg-soft/50 px-3 py-2">
                <div className="text-xs uppercase tracking-wide text-ink-faint">YTD {currentYear}</div>
                <div className="text-lg font-semibold tabular-nums leading-tight mt-0.5">{fmtMoneyFull(ytdSgd, BASE_CCY)}</div>
                {lastYtdSgd > 0 && (
                  <div className={`text-xs flex items-center gap-0.5 leading-tight ${yoyChange >= 0 ? "text-good" : "text-bad"}`}>
                    {yoyChange >= 0 ? <ArrowUpRight size={9} /> : <ArrowDownRight size={9} />}
                    {fmtPct(yoyChange, 1)} vs {lastYear}
                  </div>
                )}
              </div>
              <div className="rounded-md border border-line bg-bg-soft/50 px-3 py-2">
                <div className="text-xs uppercase tracking-wide text-ink-faint">Top payer</div>
                {topPayer ? (
                  <>
                    <div className="text-sm font-semibold leading-tight truncate mt-0.5">{topPayer.name || topPayer.symbol}</div>
                    {topPayer.name && <div className="text-ink-faint text-xs leading-tight truncate tabular-nums">{topPayer.symbol}</div>}
                    <div className="text-xs tabular-nums leading-tight">
                      <span className="text-warn font-medium">{fmtPct(topPayerPct, 2)}</span>
                      <span className="text-ink-faint"> yield · {lastFullYear}</span>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-ink-faint">—</div>
                )}
              </div>
              <div className="rounded-md border border-line bg-bg-soft/50 px-3 py-2">
                <div className="text-xs uppercase tracking-wide text-ink-faint">Avg / month</div>
                <div className="text-lg font-semibold tabular-nums leading-tight mt-0.5">
                  {fmtMoneyFull(
                    monthlySorted.length > 0
                      ? monthlySorted.reduce((s, [, v]) => s + v, 0) / monthlySorted.length
                      : 0,
                    BASE_CCY,
                  )}
                </div>
              </div>
            </div>
          </AccordionCard>

          {/* Card 2: Monthly trend */}
          {last12Months.length > 0 && (
            <AccordionCard
              id="monthly"
              title="Monthly trend"
              icon={<TrendingUp size={13} className="text-warn" />}
              open={openCard === "monthly"}
              onToggle={() => toggleCard("monthly")}
              badge={`last ${last12Months.length} mo`}
            >
              <div className="flex items-end gap-0.5 h-40">
                {last12Months.map(([k, v]) => {
                  const pct = (v / maxMonthSgd) * 100;
                  const [y, m] = k.split("-");
                  const monthLabel = new Date(Number(y), Number(m) - 1).toLocaleString("en-US", { month: "short" });
                  const isCurrentMonth = k === last12Months[last12Months.length - 1][0];
                  return (
                    <div key={k} className="flex-1 h-full flex flex-col items-stretch justify-end group relative">
                      <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block bg-bg-card border border-line rounded px-2 py-1 text-xs whitespace-nowrap z-10 shadow-lg">
                        <div className="font-medium">{monthLabel} {y}</div>
                        <div className="text-warn tabular-nums">{fmtMoneyFull(v, BASE_CCY)}</div>
                      </div>
                      <div
                        className={`w-full rounded-t transition-all ${isCurrentMonth ? "bg-warn" : "bg-warn/40 group-hover:bg-warn/70"}`}
                        style={{ height: `${Math.max(pct, 1)}%` }}
                      />
                      <div className="text-[8px] text-ink-faint text-center mt-0.5 leading-none">{monthLabel}</div>
                    </div>
                  );
                })}
              </div>
            </AccordionCard>
          )}

          {/* Card 3: Year stacked */}
          {allYears.length > 0 && (
            <AccordionCard
              id="yearly"
              title="By year · stacked"
              icon={<Calendar size={13} className="text-warn" />}
              open={openCard === "yearly"}
              onToggle={() => toggleCard("yearly")}
              badge={
                <div className="flex items-center gap-1.5 text-xs text-ink-dim">
                  {ccys.map((c) => (
                    <div key={c} className="flex items-center gap-1">
                      <div className={`w-2 h-2 rounded-sm ${colorForCcy(c)}`} />
                      <span className="font-medium">{c}</span>
                    </div>
                  ))}
                </div>
              }
            >
              <div className="space-y-1">
                {allYears.map((y) => {
                  const sgd = Number(yearTotalsSgd[y] || 0);
                  const byCcy = byYearCcySgd[y] || {};
                  return (
                    <div key={y} className="flex items-center gap-2">
                      <div className="w-10 text-xs text-ink-dim shrink-0 tabular-nums">{y}</div>
                      <div className="flex-1 h-4 rounded bg-bg-soft overflow-hidden flex">
                        {ccys.map((c) => {
                          const v = byCcy[c] || 0;
                          if (v <= 0) return null;
                          const pct = (v / maxYearSgd) * 100;
                          return (
                            <div
                              key={c}
                              className={`${colorForCcy(c)} h-full`}
                              style={{ width: `${pct}%` }}
                              title={`${c} ${fmtMoneyFull(v, BASE_CCY)}`}
                            />
                          );
                        })}
                      </div>
                      <div className="w-24 text-right text-xs tabular-nums shrink-0">
                        {fmtMoneyFull(sgd, BASE_CCY)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </AccordionCard>
          )}

          {/* Card 4: Top payers */}
          {bySymbolWithName.length > 0 && (
            <AccordionCard
              id="payers"
              title="Top payers"
              icon={<Building2 size={13} className="text-warn" />}
              open={openCard === "payers"}
              onToggle={() => toggleCard("payers")}
              badge={`by ${lastFullYear} yield`}
            >
              <div className="divide-y divide-line/50">
                {bySymbolWithName
                  .map((s: any) => {
                    const sym = s.symbol.toUpperCase();
                    const h = holdingsBySym[sym];
                    const annualDivs = lastYearDivsBySym[sym] ?? 0;
                    const yieldPct = h && h.market_value > 0 ? annualDivs / h.market_value : 0;
                    return { ...s, yieldPct };
                  })
                  .sort((a: any, b: any) => b.yieldPct - a.yieldPct)
                  .slice(0, 8)
                  .map((s: any, i: number) => {
                    const maxYield = Math.max(...bySymbolWithName.map((x: any) => {
                      const sym = x.symbol.toUpperCase();
                      const h = holdingsBySym[sym];
                      return h && h.market_value > 0 ? (lastYearDivsBySym[sym] ?? 0) / h.market_value : 0;
                    }), 0.01);
                    const pctBar = s.yieldPct / maxYield;
                    return (
                      <div key={s.symbol} className="py-1.5 flex items-center gap-2 first:pt-0 last:pb-0">
                        <div className="w-4 text-xs text-ink-faint tabular-nums">{i + 1}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <div className="font-medium text-sm truncate leading-tight">{s.name || s.symbol}</div>
                            <div className="text-sm font-semibold text-warn tabular-nums shrink-0">
                              {fmtPct(s.yieldPct, 2)}
                            </div>
                          </div>
                          {s.name && <div className="text-ink-faint text-xs truncate tabular-nums leading-tight">{s.symbol}</div>}
                          <div className="h-0.5 rounded bg-bg-soft overflow-hidden mt-0.5">
                            <div className="h-full bg-warn/60" style={{ width: `${pctBar * 100}%` }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </AccordionCard>
          )}

          {/* Card 5: By currency */}
          {ccys.length > 0 && (
            <AccordionCard
              id="currency"
              title="By currency"
              icon={<Wallet size={13} className="text-warn" />}
              open={openCard === "currency"}
              onToggle={() => toggleCard("currency")}
              badge="native totals"
            >
              <div className="divide-y divide-line/50">
                {ccys.map((ccy) => {
                  const syms = Object.entries(perCcyBySymbol[ccy] || {})
                    .sort((a, b) => b[1].total - a[1].total);
                  const ccyTotal = syms.reduce((sum, [, v]) => sum + v.total, 0);
                  const ccyTotalSgd = syms.reduce((sum, [, v]) => sum + v.totalSgd, 0);
                  const sym = ccySymbol(ccy);
                  const eventCount = syms.reduce((s, [, v]) => s + v.events, 0);
                  return (
                    <div key={ccy} className="py-2 first:pt-0 last:pb-0">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-sm ${colorForCcy(ccy)}`} />
                          <span className="text-sm font-semibold">{ccy}</span>
                          <span className="text-xs text-ink-faint">· {syms.length} payers · {eventCount} events</span>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold tabular-nums">
                            {sym} {ccyTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                          <div className="text-xs text-warn tabular-nums">
                            = {fmtMoneyFull(ccyTotalSgd, BASE_CCY)}
                          </div>
                        </div>
                      </div>
                      <div className="space-y-0.5">
                        {syms.slice(0, 3).map(([s, info]) => (
                          <div key={s} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-medium truncate leading-tight">{info.name || s}</span>
                              {info.name && <span className="text-ink-faint tabular-nums text-xs leading-tight">{s}</span>}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-ink-faint tabular-nums text-xs">{info.events}×</span>
                              <span className="tabular-nums text-warn font-medium">
                                {sym} {info.total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                          </div>
                        ))}
                        {syms.length > 3 && (
                          <div className="text-xs text-ink-faint">+{syms.length - 3} more</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </AccordionCard>
          )}
        </div>
      </div>
    </div>
  );
}

function AccordionCard({
  id,
  title,
  icon,
  open,
  onToggle,
  badge,
  children,
}: {
  id: CardId;
  title: string;
  icon?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-bg-card overflow-hidden">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-bg-soft/40 transition-colors"
      >
        {icon}
        <h2 className="text-sm font-medium flex-1">{title}</h2>
        {badge && <span className="text-xs text-ink-faint">{badge}</span>}
        {open ? <ChevronUp size={14} className="text-ink-faint" /> : <ChevronDown size={14} className="text-ink-faint" />}
      </button>
      {open && <div className="px-3 pb-3 pt-1 border-t border-line/50">{children}</div>}
    </div>
  );
}

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { fmtMoney, fmtPct } from "../lib/utils";
import { ArrowUpRight, ArrowDownRight, TrendingUp, TrendingDown, Coins, Activity, Briefcase } from "lucide-react";
import CurrencyPnL from "../components/CurrencyPnL";
import NetWorthChart from "../components/dashboard/NetWorthChart";
import { useDashboard } from "../hooks/usePortfolio";
import { LoadingScreen } from "../components/LoadingScreen";

function Pct({ p, digits = 1 }: { p: number | null | undefined; digits?: number }) {
  if (p === null || p === undefined) return <span className="text-ink-faint">—</span>;
  const good = p >= 0;
  return <span className={good ? "text-good" : "text-bad"}>{fmtPct(p, digits)}</span>;
}

export default function Dashboard() {
  const { data, isLoading } = useDashboard();

  // All hooks must be called unconditionally, before any early returns
  const holdings = data?.holdings || [];
  // Split the 7-day movers into winners (top 3) and losers (bottom 3),
  // instead of mixing them by absolute magnitude (which gave a noisy list).
  const topMovers7d = useMemo(
    () => [...holdings]
      .filter((h: any) => h.change_pct_7d !== null && h.change_pct_7d !== undefined),
    [holdings],
  );
  const bestSevenDay = useMemo(
    () => [...topMovers7d]
      .sort((a: any, b: any) => (b.change_pct_7d || 0) - (a.change_pct_7d || 0))
      .slice(0, 3),
    [topMovers7d],
  );
  const worstSevenDay = useMemo(
    () => [...topMovers7d]
      .sort((a: any, b: any) => (a.change_pct_7d || 0) - (b.change_pct_7d || 0))
      .slice(0, 3),
    [topMovers7d],
  );

  if (isLoading) return <LoadingScreen />;
  if (!data) return <div>No data</div>;

  const summary = data.summary;
  const dividends = data.dividends;
  const breakdown = data.breakdown;

  if (!summary || !breakdown) return <div>No data</div>;

  const t = breakdown.totals;
  const ccy = breakdown.base_currency;

  return (
    <div className="space-y-4">
      {/* === Hero: 3 separate cards in one row === */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Card 1: Today + Markets */}
        <div className="rounded-xl border border-line bg-bg-card shadow-sm p-3 sm:p-4">
          <DayInline pct={summary.day_change_pct} amount={summary.day_change} ccy={ccy} />
          {data.benchmarks && (
            <div className="mt-2 pt-2 border-t border-line/40 flex items-center gap-3 text-xs tabular-nums flex-wrap">
              {[
                { key: "sp500", label: "S&P 500" },
                { key: "nasdaq", label: "NASDAQ" },
                { key: "dow", label: "Dow" },
              ].map(({ key, label }) => {
                const bm = data.benchmarks[key];
                const bmPct = bm?.change_pct;
                const bmGood = (bmPct ?? 0) >= 0;
                const bmColor = bmPct == null ? "text-ink-faint" : (bmGood ? "text-good" : "text-bad");
                return (
                  <div key={key} className="flex items-center gap-1">
                    <span className="text-ink-faint">{label}</span>
                    <span className={`font-medium ${bmColor}`}>
                      {bmPct != null ? fmtPct(bmPct, 2) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Card 2: Net Worth + TWR + XIRR */}
        <div className="rounded-xl border border-line bg-bg-card shadow-sm p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <Briefcase size={11} className="text-accent" />
                <div className="text-xs uppercase tracking-[0.12em] text-ink-faint">Net Worth</div>
              </div>
              <div className="text-xl font-semibold tabular-nums tracking-tight">{fmtMoney(t.current_value, ccy)}</div>
              <div className="text-xs text-ink-faint mt-0.5 tabular-nums">
                {holdings.length} pos · cb {fmtMoney(t.capital, ccy)}
              </div>
            </div>
            <div className="flex flex-col gap-1.5 shrink-0">
              <PillStat label="TWR" pct={breakdown.header?.twr} />
              <PillStat label="XIRR" pct={breakdown.header?.xirr} />
            </div>
          </div>
        </div>

        {/* Card 3: Top Movers (Best + Worst) */}
        <div className="rounded-xl border border-line bg-bg-card shadow-sm p-3 sm:p-4 sm:col-span-2 lg:col-span-1">
          <div className="grid grid-cols-2 gap-3">
            {/* Best 7d */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <ArrowUpRight size={11} className="text-good" />
                <div className="text-xs uppercase tracking-[0.12em] text-ink-faint">Best 7d</div>
              </div>
              <div className="space-y-1">
                {bestSevenDay.length === 0 ? (
                  <div className="text-xs text-ink-faint py-1">No data</div>
                ) : bestSevenDay.map((h: any) => (
                  <div key={h.symbol} className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium truncate leading-tight">{h.name || h.symbol}</span>
                    <span className="font-semibold text-good tabular-nums shrink-0">{fmtPct(h.change_pct_7d, 1)}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Worst 7d */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <ArrowDownRight size={11} className="text-bad" />
                <div className="text-xs uppercase tracking-[0.12em] text-ink-faint">Worst 7d</div>
              </div>
              <div className="space-y-1">
                {worstSevenDay.length === 0 ? (
                  <div className="text-xs text-ink-faint py-1">No data</div>
                ) : worstSevenDay.map((h: any) => (
                  <div key={h.symbol} className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium truncate leading-tight">{h.name || h.symbol}</span>
                    <span className="font-semibold text-bad tabular-nums shrink-0">{fmtPct(h.change_pct_7d, 1)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* === P&L breakdown === */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <PnlCard
          label="Unrealized"
          value={t.current_pnl ?? 0}
          pct={t.capital > 0 ? (t.current_pnl ?? 0) / t.capital : 0}
          ccy={ccy}
          sub={`${holdings.length} open positions`}
          icon={Briefcase}
        />
        <PnlCard
          label="Realized"
          value={t.closed_pnl ?? 0}
          pct={null}
          ccy={ccy}
          sub={`${data.profile?.total_roundtrips ?? 0} roundtrips`}
          icon={Activity}
        />
        <PnlCard
          label="Dividends"
          value={t.total_div ?? 0}
          pct={null}
          ccy={ccy}
          sub={`${dividends?.summary?.events_count ?? 0} events`}
          icon={Coins}
          color="text-warn"
        />
        <PnlCard
          label="Total P&L"
          value={t.overall_pnl_div ?? 0}
          pct={t.overall_pnl_div_pct ?? 0}
          ccy={ccy}
          sub="unrealized + realized + divs"
          icon={(t.overall_pnl_div ?? 0) >= 0 ? TrendingUp : TrendingDown}
        />
      </div>

      <CurrencyPnL />

      {/* === Net worth history chart === */}
      <NetWorthChart ccy={ccy} />
    </div>
  );
}

function PnlCard({ label, value, pct, ccy, sub, icon: Icon, color }: {
  label: string;
  value: number;
  pct: number | null;
  ccy: string;
  sub: string;
  icon: any;
  color?: string;
}) {
  const good = value >= 0;
  const valColor = color || (good ? "text-good" : "text-bad");
  return (
    <div className="rounded-lg border border-line bg-bg-card p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm uppercase tracking-wide text-ink-faint">{label}</div>
        <Icon size={14} className={valColor} />
      </div>
      <div className={`text-xl font-semibold tabular-nums mt-1 ${valColor}`}>{fmtMoney(value, ccy)}</div>
      <div className="flex items-center justify-between mt-0.5">
        <div className="text-sm text-ink-faint">{sub}</div>
        {pct !== null && (
          <div className={`text-sm tabular-nums ${valColor}`}>{fmtPct(pct, 1)}</div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-sm uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}

function PillStat({ label, pct }: { label: string; pct: number | null | undefined }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-bg-soft/60 border border-line/40">
      <span className="text-xs uppercase tracking-wider text-ink-faint">{label}</span>
      <span className="text-sm font-semibold tabular-nums"><Pct p={pct} digits={2} /></span>
    </div>
  );
}

function DayInline({ pct, amount, ccy }: { pct: number | null | undefined; amount: number | null | undefined; ccy: string }) {
  const good = (pct ?? 0) >= 0;
  const hasData = pct !== null && pct !== undefined;
  const accent = good ? "good" : "bad";
  const Arrow = good ? ArrowUpRight : ArrowDownRight;

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        {hasData && <span className={`w-1.5 h-1.5 rounded-full bg-${accent} animate-pulse`} />}
        <div className="text-xs uppercase tracking-[0.12em] text-ink-faint">Today</div>
      </div>
      {hasData ? (
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <Arrow size={14} strokeWidth={2.5} className={`self-center text-${accent}`} />
          <span className={`text-xl font-semibold tabular-nums text-${accent}`}>{fmtPct(pct, 2)}</span>
          {amount !== null && amount !== undefined && (
            <span className={`text-xs tabular-nums text-${accent}/70`}>{fmtMoney(amount, ccy)}</span>
          )}
        </div>
      ) : (
        <div className="text-xl font-semibold text-ink-faint">—</div>
      )}
    </div>
  );
}

function BenchmarksInline({ benchmarks }: { benchmarks: any }) {
  return null;
}

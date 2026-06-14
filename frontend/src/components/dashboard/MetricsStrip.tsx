import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { fmtMoney, fmtPct } from "../../lib/utils";

const ACCENT_BG: Record<string, string> = {
  good: "bg-gradient-to-br from-good/10 via-transparent to-transparent",
  bad: "bg-gradient-to-br from-bad/10 via-transparent to-transparent",
};
const ACCENT_DOT: Record<string, string> = {
  good: "bg-good",
  bad: "bg-bad",
};
const ACCENT_TEXT: Record<string, string> = {
  good: "text-good",
  bad: "text-bad",
};
const ACCENT_TEXT_70: Record<string, string> = {
  good: "text-good/70",
  bad: "text-bad/70",
};

interface MetricsStripProps {
  dayPct: number | null;
  dayAmount: number | null;
  ccy: string;
  benchmarks?: any;
  twr: number | null;
  xirr: number | null;
  netWorth: number;
  positions: number;
  holdings: any[];
}

export default function MetricsStrip({
  dayPct,
  dayAmount,
  ccy,
  benchmarks,
  twr,
  xirr,
  netWorth,
  positions,
  holdings,
}: MetricsStripProps) {
  const dayGood = (dayPct ?? 0) >= 0;
  const dayAccent: "good" | "bad" = dayGood ? "good" : "bad";
  const DayArrow = dayGood ? ArrowUpRight : ArrowDownRight;
  const hasDayData = dayPct !== null && dayPct !== undefined;

  const bms = [
    { key: "sp500", label: "S&P 500" },
    { key: "nasdaq", label: "NASDAQ" },
    { key: "dow", label: "Dow" },
  ];

  const pnlColor = (n: number) => (n > 0 ? "text-good" : n < 0 ? "text-bad" : "text-ink-dim");

  // Top movers: 2 best + 2 worst (compact for the card)
  const { best, worst } = (() => {
    const with7d = [...holdings].filter(
      (h: any) => h.change_pct_7d !== null && h.change_pct_7d !== undefined
    );
    return {
      best: with7d
        .slice()
        .sort((a: any, b: any) => (b.change_pct_7d || 0) - (a.change_pct_7d || 0))
        .slice(0, 2),
      worst: with7d
        .slice()
        .sort((a: any, b: any) => (a.change_pct_7d || 0) - (b.change_pct_7d || 0))
        .slice(0, 2),
    };
  })();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {/* Net Worth card — primary, with TWR/XIRR inline */}
      <div className={`rounded-xl border border-line bg-bg-card px-4 py-3 ${ACCENT_BG[dayAccent]}`}>
        <div className="flex items-center gap-1.5 mb-1">
          <span className={`w-1.5 h-1.5 rounded-full ${ACCENT_DOT[dayAccent]} animate-pulse`} />
          <div className="text-sm uppercase tracking-wider text-ink-faint">Net worth</div>
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-semibold tabular-nums tracking-tight text-ink">
            {fmtMoney(netWorth, ccy)}
          </span>
          <div className="flex items-center gap-3 text-sm tabular-nums">
            <span className="flex items-baseline gap-1">
              <span className="text-ink-faint">TWR</span>
              <span className={`font-semibold ${pnlColor(twr ?? 0)}`}>
                {twr != null ? fmtPct(twr, 2) : "—"}
              </span>
            </span>
            <span className="w-px h-3.5 bg-line/60" />
            <span className="flex items-baseline gap-1">
              <span className="text-ink-faint">XIRR</span>
              <span className={`font-semibold ${pnlColor(xirr ?? 0)}`}>
                {xirr != null ? fmtPct(xirr, 2) : "—"}
              </span>
            </span>
          </div>
        </div>
        <div className="text-sm text-ink-faint mt-0.5">{positions} positions</div>
      </div>

      {/* Today card — daily gain/loss with benchmarks */}
      <div className={`rounded-xl border border-line bg-bg-card px-4 py-3 ${ACCENT_BG[dayAccent]}`}>
        <div className="flex items-center gap-1.5 mb-1">
          <span className={`w-1.5 h-1.5 rounded-full ${ACCENT_DOT[dayAccent]} animate-pulse`} />
          <div className="text-sm uppercase tracking-wider text-ink-faint">Today</div>
        </div>
        <div className="flex items-baseline gap-2 flex-wrap">
          {hasDayData ? (
            <>
              <DayArrow size={16} strokeWidth={2.5} className={`self-center ${ACCENT_TEXT[dayAccent]}`} />
              <span className={`text-2xl font-semibold tabular-nums tracking-tight ${ACCENT_TEXT[dayAccent]}`}>
                {fmtPct(dayPct, 2)}
              </span>
              {dayAmount !== null && (
                <span className={`text-sm tabular-nums ${ACCENT_TEXT_70[dayAccent]}`}>
                  {fmtMoney(dayAmount, ccy)}
                </span>
              )}
            </>
          ) : (
            <span className="text-2xl font-semibold text-ink-faint">—</span>
          )}
        </div>
        {benchmarks && (
          <div className="flex items-center gap-2.5 mt-0.5 text-sm tabular-nums flex-wrap">
            {bms.map(({ key, label }) => {
              const bmPct = benchmarks[key]?.change_pct;
              const bmGood = (bmPct ?? 0) >= 0;
              const c = bmPct == null ? "text-ink-faint" : bmGood ? "text-good" : "text-bad";
              return (
                <span key={key} className="flex items-center gap-1">
                  <span className="text-ink-faint">{label}</span>
                  <span className={`font-medium ${c}`}>{bmPct != null ? fmtPct(bmPct, 2) : "—"}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Top movers card */}
      <div className="rounded-xl border border-line bg-bg-card px-4 py-3">
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-sm uppercase tracking-wider text-ink-faint">Top movers · 7d</div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-line/50">
          <div className="pr-2 min-w-0">
            {best.length === 0 ? (
              <div className="text-sm text-ink-faint py-1.5">No 7d data</div>
            ) : (
              best.map((h: any) => (
                <div key={h.symbol} className="flex items-center justify-between gap-1 py-0.5">
                  <div className="text-sm font-medium truncate">{h.name || h.symbol}</div>
                  <div className="text-sm font-semibold tabular-nums text-good shrink-0">
                    {fmtPct(h.change_pct_7d, 1)}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="pl-2 min-w-0">
            {worst.length === 0 ? (
              <div className="text-sm text-ink-faint py-1.5">No data</div>
            ) : (
              worst.map((h: any) => (
                <div key={h.symbol} className="flex items-center justify-between gap-1 py-0.5">
                  <div className="text-sm font-medium truncate">{h.name || h.symbol}</div>
                  <div className="text-sm font-semibold tabular-nums text-bad shrink-0">
                    {fmtPct(h.change_pct_7d, 1)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

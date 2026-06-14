import { fmtPct, fmtMoneyFull, ccySymbol } from "../lib/utils";
import { Coins } from "lucide-react";
import { useDashboard } from "../hooks/usePortfolio";

interface BreakdownRow {
  currency: string;
  current_value: number | null;
  current_value_pct: number | null;
  day_change: number | null;
  day_change_pct: number | null;
  current_pnl: number | null;
  current_pnl_div: number | null;
  current_pnl_div_pct: number | null;
  current_pnl_base: number | null;
  current_pnl_div_base: number | null;
  closed_pnl: number | null;
  closed_pnl_div: number | null;
  closed_pnl_base: number | null;
  closed_pnl_div_base: number | null;
  overall_pnl_div: number | null;
  overall_pnl_div_pct: number | null;
  overall_pnl_div_base: number | null;
  current_div: number | null;
  current_div_base: number | null;
  closed_div: number | null;
  closed_div_base: number | null;
  total_div: number | null;
  total_div_base: number | null;
  current_value_base: number | null;
}

interface Breakdown {
  rows: BreakdownRow[];
  totals: BreakdownRow;
  base_currency: string;
  header: {
    twr: number;
    xirr: number;
    capital: number;
    net_worth: number;
    base_currency: string;
  };
}

const BASE_CCY = "SGD";

const CCY_COLORS: Record<string, string> = {
  USD: "bg-accent",
  SGD: "bg-warn",
  HKD: "bg-good",
  GBP: "bg-bad",
  CNY: "bg-info",
  EUR: "bg-info",
};

export default function CurrencyPnL() {
  const { data: dashboardData, isLoading } = useDashboard();
  const data = dashboardData?.breakdown as Breakdown | undefined;

  if (isLoading) return <div className="text-ink-dim text-sm py-3">Loading…</div>;
  if (!data) return null;

  const ccy = data.base_currency;
  const valColor = (n: number) => (n > 0 ? "text-good" : n < 0 ? "text-bad" : "text-ink-dim");
  const maxMv = Math.max(...data.rows.map((r) => r.current_value ?? 0), 1);

  return (
    <div className="rounded-lg border border-line bg-bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-line flex items-center justify-between bg-bg-soft/40">
        <div className="flex items-center gap-2">
          <Coins size={14} className="text-ink-faint" />
          <h2 className="text-sm font-medium">P&L by currency</h2>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-ink-faint text-sm uppercase border-b border-line bg-bg-soft/30">
              <th className="text-left pl-3 sm:pl-5 pr-3 py-2 font-medium">Currency</th>
              <th className="text-right px-3 py-2 font-medium">Market value</th>
              <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Day</th>
              <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Unrealized</th>
              <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Realized</th>
              <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Dividends</th>
              <th className="text-right pr-3 sm:pr-5 pl-3 py-2 font-medium">Total P&L</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const mv = r.current_value ?? 0;
              const mvPct = mv / maxMv;
              const day = r.day_change ?? 0;
              const dayPct = r.day_change_pct ?? 0;
              const unreal = r.current_pnl ?? 0;
              const real = r.closed_pnl ?? 0;
              const div = r.total_div ?? 0;
              const total = r.overall_pnl_div ?? 0;
              const overallPct = r.overall_pnl_div_pct ?? 0;
              const sym = ccySymbol(r.currency);
              return (
                <tr key={r.currency} className="border-b border-line/50 hover:bg-bg-soft/40 transition-colors">
                  <td className="pl-3 sm:pl-5 pr-3 py-3 align-middle">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${CCY_COLORS[r.currency] || "bg-ink-faint"}`} />
                      <div>
                        <div className="font-semibold text-sm leading-tight">{r.currency}</div>
                        <div className="text-sm text-ink-faint tabular-nums">
                          {fmtPct(r.current_value_pct ?? 0, 1)} of portfolio
                        </div>
                      </div>
                    </div>
                    <div className="mt-1.5 h-0.5 rounded bg-bg-soft overflow-hidden">
                      <div
                        className={`h-full ${CCY_COLORS[r.currency] || "bg-ink-faint"} opacity-60`}
                        style={{ width: `${Math.max(mvPct * 100, 2)}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums align-middle">
                    <div className="font-semibold">{fmtMoneyFull(mv, r.currency)}</div>
                  </td>
                  <td className={`px-3 py-3 text-right tabular-nums align-middle hidden sm:table-cell ${valColor(day)}`}>
                    <div>{fmtMoneyFull(day, r.currency)}</div>
                    <div className="text-sm mt-0.5">{fmtPct(dayPct, 2)}</div>
                  </td>
                  <td className={`px-3 py-3 text-right tabular-nums align-middle hidden sm:table-cell ${valColor(unreal)}`}>
                    {fmtMoneyFull(unreal, r.currency)}
                  </td>
                  <td className={`px-3 py-3 text-right tabular-nums align-middle hidden sm:table-cell ${valColor(real)}`}>
                    {fmtMoneyFull(real, r.currency)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums align-middle hidden sm:table-cell">
                    <span className={valColor(div)}>{fmtMoneyFull(div, r.currency)}</span>
                  </td>
                  <td className={`pr-3 sm:pr-5 pl-3 py-3 text-right tabular-nums align-middle ${valColor(total)}`}>
                    <div className="font-semibold">{fmtMoneyFull(total, r.currency)}</div>
                    <div className="text-sm mt-0.5">{fmtPct(overallPct, 1)}</div>
                  </td>
                </tr>
              );
            })}
            {/* Totals row - in base currency */}
            <tr className="border-t-2 border-line bg-bg-soft/60 font-semibold">
              <td className="pl-3 sm:pl-5 pr-3 py-3 align-middle">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-sm bg-ink-dim" />
                  <div>
                    <div className="text-sm leading-tight">Total ({ccy})</div>
                    <div className="text-sm text-ink-faint">100% of portfolio</div>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3 text-right tabular-nums align-middle">
                <div className="text-base">{fmtMoneyFull(data.totals.current_value ?? 0, ccy)}</div>
              </td>
              <td className={`px-3 py-3 text-right tabular-nums align-middle hidden sm:table-cell ${valColor(data.totals.day_change ?? 0)}`}>
                <div className="text-base">{fmtMoneyFull(data.totals.day_change ?? 0, ccy)}</div>
                <div className="text-sm mt-0.5">{fmtPct(data.totals.day_change_pct ?? 0, 2)}</div>
              </td>
              <td className={`px-3 py-3 text-right tabular-nums align-middle hidden sm:table-cell ${valColor(data.totals.current_pnl ?? 0)}`}>
                {fmtMoneyFull(data.totals.current_pnl ?? 0, ccy)}
              </td>
              <td className={`px-3 py-3 text-right tabular-nums align-middle hidden sm:table-cell ${valColor(data.totals.closed_pnl ?? 0)}`}>
                {fmtMoneyFull(data.totals.closed_pnl ?? 0, ccy)}
              </td>
              <td className="px-3 py-3 text-right tabular-nums align-middle hidden sm:table-cell">
                <span className={valColor(data.totals.total_div ?? 0)}>{fmtMoneyFull(data.totals.total_div ?? 0, ccy)}</span>
              </td>
              <td className={`pr-3 sm:pr-5 pl-3 py-3 text-right tabular-nums align-middle ${valColor(data.totals.overall_pnl_div ?? 0)}`}>
                <div className="text-base">{fmtMoneyFull(data.totals.overall_pnl_div ?? 0, ccy)}</div>
                <div className="text-sm mt-0.5">{fmtPct(data.totals.overall_pnl_div_pct ?? 0, 1)}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

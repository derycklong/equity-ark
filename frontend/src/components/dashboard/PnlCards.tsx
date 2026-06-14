import { fmtMoney, fmtPct } from "../../lib/utils";

interface PnlCardsProps {
  totals: any;
  ccy: string;
  positions: number;
  roundtrips: number;
  dividendEvents: number;
}

export default function PnlCards({ totals, ccy, positions, roundtrips, dividendEvents }: PnlCardsProps) {
  const unrealized = totals.current_pnl ?? 0;
  const realized = totals.closed_pnl ?? 0;
  const dividends = totals.total_div ?? 0;
  const totalPnl = totals.overall_pnl_div ?? 0;
  const totalPnlPct = totals.overall_pnl_div_pct ?? 0;
  const capital = totals.capital ?? 0;
  const unrealizedPct = capital > 0 ? unrealized / capital : 0;

  const pnlColor = (n: number) => (n > 0 ? "text-good" : n < 0 ? "text-bad" : "text-ink-dim");

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <PnlCard
        label="Unrealized"
        value={fmtMoney(unrealized, ccy)}
        valueClass={pnlColor(unrealized)}
        meta={fmtPct(unrealizedPct, 1)}
        sub={`${positions} open`}
      />
      <PnlCard
        label="Realized"
        value={fmtMoney(realized, ccy)}
        valueClass={pnlColor(realized)}
        sub={`${roundtrips} roundtrips`}
      />
      <PnlCard
        label="Dividends"
        value={fmtMoney(dividends, ccy)}
        valueClass="text-warn"
        sub={`${dividendEvents} events`}
      />
      <PnlCard
        label="Total P&L"
        value={fmtMoney(totalPnl, ccy)}
        valueClass={pnlColor(totalPnl)}
        meta={fmtPct(totalPnlPct, 1)}
        sub="unrealized + realized + divs"
      />
    </div>
  );
}

function PnlCard({
  label,
  value,
  valueClass,
  meta,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  valueClass: string;
  meta?: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-line bg-bg-card px-4 py-3 ${
        highlight ? "bg-bg-soft/30" : ""
      }`}
    >
      <div className="text-sm uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="flex items-baseline gap-2 mt-0.5 flex-wrap">
        <span className={`text-xl font-semibold tabular-nums tracking-tight ${valueClass}`}>
          {value}
        </span>
        {meta && <span className={`text-sm tabular-nums ${valueClass}`}>{meta}</span>}
      </div>
      <div className="text-sm text-ink-faint truncate mt-0.5">{sub}</div>
    </div>
  );
}

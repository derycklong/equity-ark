import { Target } from "lucide-react";
import { fmtMoney, fmtNum, fmtPct, fmtDate } from "../../lib/utils";

interface TradingProfileProps {
  profile: any;
  ccy: string;
}

export default function TradingProfile({ profile, ccy }: TradingProfileProps) {
  const stats = [
    { label: "Win rate", value: <Pct p={profile.win_rate} digits={1} /> },
    { label: "Profit / loss", value: fmtNum(profile.profit_loss_ratio, 2) },
    { label: "Avg holding", value: `${fmtNum(profile.avg_holding_days, 0)} d` },
    { label: "Transactions", value: profile.total_transactions },
    { label: "Roundtrips", value: profile.total_roundtrips },
    { label: "Best trade", value: <span className="text-good">{fmtMoney(profile.largest_winner, ccy)}</span> },
    { label: "Worst trade", value: <span className="text-bad">{fmtMoney(profile.largest_loser, ccy)}</span> },
    { label: "Avg winner", value: <span className="text-good">{fmtMoney(profile.avg_winner, ccy)}</span> },
    { label: "Avg loser", value: <span className="text-bad">{fmtMoney(profile.avg_loser, ccy)}</span> },
    { label: "Total fees", value: fmtMoney(profile.total_fees, ccy) },
    { label: "Total divs", value: fmtMoney(profile.total_dividends, ccy) },
    { label: "Realized", value: <Signed n={profile.total_realized_pnl} ccy={ccy} /> },
  ];

  return (
    <div className="rounded-xl border border-line bg-bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Target size={12} className="text-ink-faint" />
        <h2 className="text-sm font-medium">Trading profile</h2>
        <span className="text-sm text-ink-faint ml-auto">
          {fmtDate(profile.start_date)} → {fmtDate(profile.end_date)} · {profile.span_days} days
        </span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-x-3 gap-y-1.5 text-sm">
        {stats.map((s) => (
          <div key={s.label} className="min-w-0">
            <div className="text-sm uppercase tracking-wider text-ink-faint truncate leading-tight">{s.label}</div>
            <div className="text-sm font-medium tabular-nums truncate leading-tight">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Signed({ n, ccy = "SGD" }: { n: number | null | undefined; ccy?: string }) {
  if (n === null || n === undefined) return <span className="text-ink-faint">—</span>;
  const good = n >= 0;
  return <span className={good ? "text-good" : "text-bad"}>{fmtMoney(n, ccy)}</span>;
}

function Pct({ p, digits = 1 }: { p: number | null | undefined; digits?: number }) {
  if (p === null || p === undefined) return <span className="text-ink-faint">—</span>;
  const good = p >= 0;
  return <span className={good ? "text-good" : "text-bad"}>{fmtPct(p, digits)}</span>;
}

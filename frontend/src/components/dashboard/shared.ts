export const MARKET_LABELS: Record<string, string> = {
  us: "US Equities",
  hk: "HK Equities",
  uk: "UK / LSE",
  sg: "SG / SGX",
  sg_bond: "SG Savings Bonds",
  cn: "China A-Shares",
  fund: "Mutual Funds",
  cash: "Cash",
  other: "Other",
};

export function marketLabel(m: string): string {
  return MARKET_LABELS[m] || m;
}

export const CCY_COLORS: Record<string, string> = {
  USD: "#60a5fa",
  SGD: "#f59e0b",
  HKD: "#22c55e",
  GBP: "#ef4444",
  CNY: "#a78bfa",
  EUR: "#a78bfa",
  JPY: "#f472b6",
  AUD: "#38bdf8",
  CAD: "#fb923c",
};

export const MARKET_COLORS: Record<string, string> = {
  us: "#60a5fa",
  hk: "#22c55e",
  uk: "#a78bfa",
  sg: "#f59e0b",
  sg_bond: "#f472b6",
  cn: "#ef4444",
  fund: "#38bdf8",
  cash: "#22d3ee",
  other: "#9ca3af",
};

export function colorForCcy(ccy: string): string {
  return CCY_COLORS[ccy.toUpperCase()] || "#9ca3af";
}

export function colorForMarket(market: string): string {
  return MARKET_COLORS[market] || "#9ca3af";
}

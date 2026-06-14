const base = "";

async function request<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${base}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    ...init,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`API ${r.status}: ${t}`);
  }
  return r.json();
}

export const api = {
  health: () => request<{ status: string; users: number; cached_stores: number; llm_enabled: boolean }>("/api/health"),
  authMe: () => request<{ user: { id: string; email: string; name: string; picture: string } }>("/api/auth/me"),
  authGoogleLogin: () => { window.location.href = "/api/auth/google/login"; },
  authLogout: () => request<{ status: string }>("/api/auth/logout", { method: "POST" }),
  summary: () => request<any>("/api/portfolio/summary"),
  currencyBreakdown: (base = "SGD") => request<any>(`/api/portfolio/currency-breakdown?base_currency=${base}`),
  holdings: (refresh = false) => request<{ holdings: any[]; prices: any[] }>(`/api/portfolio/holdings?refresh=${refresh}`),
  transactions: (filters: { symbol?: string; market?: string } = {}) => {
    const q = new URLSearchParams();
    if (filters.symbol) q.set("symbol", filters.symbol);
    if (filters.market) q.set("market", filters.market);
    return request<{ transactions: any[]; count: number }>(`/api/portfolio/transactions?${q.toString()}`);
  },
  roundtrips: () => request<{ roundtrips: any[]; profile: any }>("/api/portfolio/roundtrips"),
  dividends: () => request<{ summary: any; events: any[] }>("/api/portfolio/dividends"),
  profile: () => request<any>("/api/portfolio/profile"),
  reload: () => request<any>("/api/portfolio/reload", { method: "POST" }),
  advice: (focus: string, custom_question?: string, refresh = false) =>
    request<any>("/api/portfolio/advice", {
      method: "POST",
      body: JSON.stringify({ focus, custom_question, refresh }),
    }),
  upload: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/portfolio/upload", { method: "POST", body: fd });
    if (!r.ok) {
      let msg = `${r.status}`;
      try { msg = (await r.json()).detail || msg; } catch { msg = await r.text(); }
      throw new Error(msg);
    }
    return r.json() as Promise<{ imported: number; skipped: number; errors: string[] }>;
  },
  addTransaction: (tx: {
    date: string;
    side: string;
    symbol: string;
    exchange: string;
    quantity: number;
    price: number;
    currency: string;
    fees?: number;
    label?: string;
    note?: string;
  }) =>
    request<{ added: string; transactions: number; holdings: number; roundtrips: number }>(
      "/api/portfolio/transactions",
      { method: "POST", body: JSON.stringify(tx) },
    ),
  updateTransaction: (id: number, tx: {
    date: string;
    side: string;
    symbol: string;
    exchange: string;
    quantity: number;
    price: number;
    currency: string;
    fees?: number;
    label?: string;
    note?: string;
  }) =>
    request<{ updated: number; symbol: string; transactions: number; holdings: number; roundtrips: number }>(
      `/api/portfolio/transactions/${id}`,
      { method: "PUT", body: JSON.stringify(tx) },
    ),
  deleteTransaction: (id: number) =>
    request<{ deleted: number; id: number; transactions: number; holdings: number; roundtrips: number }>(
      `/api/portfolio/transactions/id/${id}`,
      { method: "DELETE" },
    ),
  deleteTransactionsBySymbol: (symbol: string) =>
    request<{ deleted: number; symbol: string; transactions: number }>(
      `/api/portfolio/transactions/${symbol}`,
      { method: "DELETE" },
    ),
  bulkDeleteTransactions: (ids: number[]) =>
    request<{ deleted: number; ids: number[]; transactions: number; holdings: number; roundtrips: number }>(
      "/api/portfolio/transactions/bulk-delete",
      { method: "POST", body: JSON.stringify({ ids }) },
    ),
  backfillTransactionNames: () =>
    request<{ updated: number; checked: number }>(
      "/api/portfolio/transactions/backfill-names",
      { method: "POST" },
    ),
  validateSymbol: (symbol: string, exchange: string = "USX") =>
    request<{ valid: boolean; symbol: string; name: string | null; market?: string; yahoo_symbol?: string }>(
      `/api/portfolio/symbols/validate?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}`,
    ),
  dashboard: () =>
    request<{ summary: any; breakdown: any; profile: any; holdings: any[]; dividends: any; benchmarks?: any }>("/api/portfolio/dashboard"),
  networthHistory: () =>
    request<{ base_currency: string; history: { date: string; net_worth: number; net_buy_sell: number }[] }>(
      "/api/portfolio/networth-history",
    ),
  cacheRefresh: () =>
    request<{ holdings: number; prices_updated: number; dividends_refreshed: number; dividend_events: number }>("/api/portfolio/cache/refresh", { method: "POST" }),
  cacheStatus: () =>
    request<{ cached: boolean; age_hours: number | null }>("/api/portfolio/cache/status"),
  listFundAliases: () =>
    request<{ aliases: { alias: string; isin: string; fund_name: string }[] }>("/api/portfolio/fund-aliases"),
  saveFundAlias: (alias: string, isin: string, fund_name: string) =>
    request("/api/portfolio/fund-aliases", { method: "POST", body: JSON.stringify({ alias, isin, fund_name }) }),
  deleteFundAlias: (alias: string) =>
    request(`/api/portfolio/fund-aliases/${encodeURIComponent(alias)}`, { method: "DELETE" }),
};

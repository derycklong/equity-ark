import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtNum, fmtDate, ccySymbol } from "../lib/utils";
import { Trash2, Plus, Pencil, X, ArrowUpDown, ArrowUp, ArrowDown, Check, Loader2, Save, Upload, AlertOctagon, CheckCircle2, AlertTriangle, Download, FileDown } from "lucide-react";
import { qk, useTransactions, useInvalidateAll } from "../hooks/usePortfolio";
import { LoadingScreen } from "../components/LoadingScreen";

type Tx = {
  id: number | null;
  date: string;
  side: string;
  symbol: string;
  name?: string;
  exchange: string;
  quantity: number;
  price: number;
  gross_amount: number;
  net_amount: number;
  fees: number;
  currency: string;
  label: string;
  note: string;
};

type SortKey = "date" | "symbol" | "side" | "currency" | "quantity" | "price" | "gross_amount";

const EXCHANGES = ["USX", "HKEX", "LSE", "SGX", "SSB", "FUND"] as const;
const CURRENCIES = ["USD", "SGD", "HKD", "GBP", "CNY"] as const;
const BASE_CCY = "SGD";

function toBase(amt: number, ccy: string): number {
  const rates: Record<string, number> = {
    SGD: 1,
    USD: 1 / 0.74,
    HKD: 0.128 / 0.74,
    GBP: 1.27 / 0.74,
    CNY: 0.14 / 0.74,
  };
  return amt * (rates[ccy] || 1);
}

interface TxFormState {
  date: string;
  side: "buy" | "sell";
  symbol: string;
  exchange: string;
  quantity: string;
  price: string;
  currency: string;
  fees: string;
  label: string;
  note: string;
}

const INITIAL_FORM: TxFormState = {
  date: new Date().toISOString().split("T")[0],
  side: "buy",
  symbol: "",
  exchange: "USX",
  quantity: "",
  price: "",
  currency: "USD",
  fees: "0",
  label: "",
  note: "",
};

function TxForm({
  initial,
  loading,
  error,
  onSubmit,
  onCancel,
}: {
  initial: TxFormState;
  loading: boolean;
  error: string | null;
  onSubmit: (form: TxFormState) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<TxFormState>(initial);
  const set = (field: keyof TxFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  // Symbol validation
  const [symbolStatus, setSymbolStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const [symbolName, setSymbolName] = useState<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);
  const noteRef = useRef(form.note);
  noteRef.current = form.note;

  const validateSymbol = useCallback((sym: string, exch: string) => {
    if (!sym || sym.length < 1) {
      setSymbolStatus("idle");
      setSymbolName("");
      return;
    }
    const id = ++reqIdRef.current;
    setSymbolStatus("checking");
    if (exch === "FUND") {
      api.validateSymbol(sym, "FUND").then((r) => {
        if (id !== reqIdRef.current) return;
        setSymbolStatus("valid");
        setSymbolName(r.name || "");
        if (r.name && sym.length >= 6) setForm((f) => ({ ...f, note: r.name! }));
      }).catch(() => {
        if (id !== reqIdRef.current) return;
        setSymbolStatus("valid");
        setSymbolName("");
      });
      return;
    }
    api.validateSymbol(sym, exch).then((r) => {
      if (id !== reqIdRef.current) return;
      setSymbolStatus(r.valid ? "valid" : "invalid");
      setSymbolName(r.name || "");
    }).catch(() => {
      if (id !== reqIdRef.current) return;
      setSymbolStatus("invalid");
      setSymbolName("");
    });
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => validateSymbol(form.symbol, form.exchange), 500);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [form.symbol, form.exchange, validateSymbol]);

  const gross = (parseFloat(form.quantity) || 0) * (parseFloat(form.price) || 0);
  const isEdit = !!initial.symbol;
  const canSubmit = isEdit || symbolStatus === "valid";

  // Fund alias support
  const [fundAliases, setFundAliases] = useState<{ alias: string; isin: string; fund_name: string }[]>([]);
  const [showAliasInput, setShowAliasInput] = useState(false);
  const [newAlias, setNewAlias] = useState("");
  const [showManageAliases, setShowManageAliases] = useState(false);

  useEffect(() => {
    if (form.exchange === "FUND") {
      api.listFundAliases().then((r) => setFundAliases(r.aliases)).catch(() => {});
    }
  }, [form.exchange]);

  const handleAliasSelect = (alias: string) => {
    const f = fundAliases.find((a) => a.alias === alias);
    if (f) {
      setForm((prev) => ({ ...prev, symbol: f.isin, note: f.fund_name }));
    }
  };

  const handleSaveAlias = async () => {
    if (!newAlias.trim() || !form.symbol) return;
    await api.saveFundAlias(newAlias.trim().toUpperCase(), form.symbol, form.note);
    setNewAlias("");
    setShowAliasInput(false);
    const r = await api.listFundAliases();
    setFundAliases(r.aliases);
  };

  const handleDeleteAlias = async (alias: string) => {
    await api.deleteFundAlias(alias);
    const r = await api.listFundAliases();
    setFundAliases(r.aliases);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop — only close on direct click, not via child propagation */}
      <div className="absolute inset-0 bg-black/60" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }} />
      <div className="relative rounded-lg border border-line bg-bg-card w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
                  <h2 className="text-sm font-semibold">{initial.symbol ? "Edit Transaction" : "Add Transaction"}</h2>
          <button onClick={onCancel} className="text-ink-faint hover:text-ink"><X size={18} /></button>
        </div>
        {error && (
          <div className="mx-4 mt-3 rounded-md bg-bad/10 border border-bad/20 text-bad text-sm px-3 py-2">
            {error}
          </div>
        )}
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-ink-faint mb-1">Date</label>
              <input type="date" value={form.date} onChange={set("date")}
                className="w-full rounded-md border border-line bg-bg-soft px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-sm text-ink-faint mb-1">Side</label>
              <div className="flex gap-1">
                {(["buy", "sell"] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setForm((f) => ({ ...f, side: s }))}
                    className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium capitalize transition-colors ${
                      form.side === s
                        ? s === "buy" ? "bg-good/20 border-good text-good" : "bg-bad/20 border-bad text-bad"
                        : "border-line bg-bg-soft text-ink-faint hover:border-ink-dim"
                    }`}>{s}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {form.exchange !== "FUND" && (
              <div>
                <label className="block text-sm text-ink-faint mb-1">Symbol *</label>
                <div className="relative">
                  <input type="text" value={form.symbol} onChange={set("symbol")}
                    placeholder="e.g. AAPL"
                    className={`w-full rounded-md border bg-bg-soft px-3 py-2 pr-8 text-sm uppercase ${
                      !isEdit && form.symbol
                        ? symbolStatus === "valid" ? "border-good"
                        : symbolStatus === "invalid" ? "border-bad"
                        : symbolStatus === "checking" ? "border-warn"
                        : "border-line"
                        : "border-line"
                    }`} required />
                  {!isEdit && form.symbol && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2">
                      {symbolStatus === "checking" && <Loader2 size={14} className="text-warn animate-spin" />}
                      {symbolStatus === "valid" && <Check size={14} className="text-good" />}
                      {symbolStatus === "invalid" && <X size={14} className="text-bad" />}
                    </span>
                  )}
                </div>
                {!isEdit && symbolName && symbolStatus === "valid" && (
                  <div className="text-sm text-ink-faint mt-0.5 truncate">{symbolName}</div>
                )}
                {!isEdit && symbolStatus === "invalid" && form.symbol && (
                  <div className="text-sm text-bad mt-0.5">Symbol not found on yfinance</div>
                )}
              </div>
            )}
            <div className={form.exchange === "FUND" ? "" : ""}>
              <label className="block text-sm text-ink-faint mb-1">Exchange</label>
              <select value={form.exchange} onChange={(e) => {
                setForm((f) => ({
                  ...f,
                  exchange: e.target.value,
                  currency: e.target.value === "FUND" ? "SGD" : f.currency,
                }));
              }}
                className="w-full rounded-md border border-line bg-bg-soft px-3 py-2 text-sm">
                {EXCHANGES.map((ex) => <option key={ex} value={ex}>{ex}</option>)}
              </select>
            </div>
          </div>
          {form.exchange === "FUND" && (
            <>
              {/* Saved funds dropdown */}
              {fundAliases.length > 0 && (
                <div>
                  <label className="block text-sm text-ink-faint mb-1">Saved funds</label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select
                      value=""
                      onChange={(e) => handleAliasSelect(e.target.value)}
                      className="flex-1 rounded-md border border-line bg-bg-soft px-3 py-2 text-sm"
                    >
                      <option value="">Select a saved fund…</option>
                      {fundAliases.map((a) => (
                        <option key={a.alias} value={a.alias}>{a.alias} — {a.fund_name}</option>
                      ))}
                    </select>
                    <button onClick={() => setShowManageAliases(!showManageAliases)}
                      className="rounded-md border border-line bg-bg-soft px-2 py-2 text-sm hover:bg-bg-card">
                      {showManageAliases ? "Done" : "Edit"}
                    </button>
                  </div>
                  {showManageAliases && (
                    <div className="mt-1 space-y-0.5">
                      {fundAliases.map((a) => (
                        <div key={a.alias} className="flex items-center justify-between text-sm px-2 py-1 rounded hover:bg-bg-soft">
                          <span><span className="font-medium">{a.alias}</span> → {a.fund_name}</span>
                          <button onClick={() => handleDeleteAlias(a.alias)}
                            className="text-bad hover:text-bad/80">
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* ISIN input */}
              <div>
                <label className="block text-sm text-ink-faint mb-1">ISIN / Code *</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input type="text" value={form.symbol} onChange={set("symbol")} placeholder="e.g. SGX262558192"
                      className={`w-full rounded-md border bg-bg-soft px-3 py-2 pr-8 text-sm ${
                        !isEdit && form.symbol
                          ? symbolStatus === "checking" ? "border-warn"
                          : "border-line"
                          : "border-line"
                      }`} required />
                    {!isEdit && form.symbol && (
                      <span className="absolute right-2 top-1/2 -translate-y-1/2">
                        {symbolStatus === "checking" && <Loader2 size={14} className="text-warn animate-spin" />}
                        {symbolStatus === "valid" && <Check size={14} className="text-good" />}
                      </span>
                    )}
                  </div>
                  <button onClick={() => { setNewAlias(""); setShowAliasInput(true); }}
                    disabled={!form.symbol}
                    className="shrink-0 rounded-md border border-line bg-bg-soft px-2 py-2 text-sm hover:bg-bg-card disabled:opacity-40">
                    <Save size={13} />
                  </button>
                </div>
                {!isEdit && symbolName && (
                  <div className="text-sm text-ink-faint mt-0.5 truncate">{symbolName}</div>
                )}
              </div>
              {/* Save alias popup */}
              {showAliasInput && (
                <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                  <input type="text" value={newAlias} onChange={(e) => setNewAlias(e.target.value)}
                    placeholder="Short name (e.g. ABRDNINC)"
                    className="flex-1 rounded-md border border-line bg-bg-soft px-3 py-1.5 text-sm"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveAlias(); }} />
                  <div className="flex gap-2">
                    <button onClick={handleSaveAlias} disabled={!newAlias.trim()}
                      className="rounded bg-brand text-white px-2 py-1.5 text-sm font-medium disabled:opacity-40">Save</button>
                    <button onClick={() => setShowAliasInput(false)}
                      className="rounded border border-line px-2 py-1.5 text-sm">Cancel</button>
                  </div>
                </div>
              )}
              {/* Fund name */}
              <div>
                <label className="block text-sm text-ink-faint mb-1">Fund name *</label>
                <input type="text" value={form.note} onChange={set("note")} placeholder="e.g. ABRDN Income Plus Fund"
                  className="w-full rounded-md border border-line bg-bg-soft px-3 py-2 text-sm" required />
              </div>
            </>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm text-ink-faint mb-1">{form.exchange === "FUND" ? "Units *" : "Qty *"}</label>
              <input type="number" value={form.quantity} onChange={set("quantity")} min="0" step="any" placeholder="0"
                className="w-full rounded-md border border-line bg-bg-soft px-3 py-2 text-sm tabular-nums" required />
            </div>
            <div>
              <label className="block text-sm text-ink-faint mb-1">{form.exchange === "FUND" ? "NAV *" : "Price *"}</label>
              <input type="number" value={form.price} onChange={set("price")} min="0" step="any" placeholder="0.0000"
                className="w-full rounded-md border border-line bg-bg-soft px-3 py-2 text-sm tabular-nums" required />
            </div>
            <div>
              <label className="block text-sm text-ink-faint mb-1">Fees</label>
              <input type="number" value={form.fees} onChange={set("fees")} min="0" step="any" placeholder="0"
                className="w-full rounded-md border border-line bg-bg-soft px-3 py-2 text-sm tabular-nums" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-ink-faint mb-1">Currency</label>
              <select value={form.currency} onChange={set("currency")}
                className="w-full rounded-md border border-line bg-bg-soft px-3 py-2 text-sm">
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-ink-faint mb-1">Label</label>
              <input type="text" value={form.label} onChange={set("label")} placeholder="e.g. US Market"
                className="w-full rounded-md border border-line bg-bg-soft px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-sm text-ink-faint mb-1">Note</label>
            <textarea value={form.note} onChange={set("note")} rows={2} placeholder="Optional"
              className="w-full rounded-md border border-line bg-bg-soft px-3 py-2 text-sm resize-none" />
          </div>
          <div className="flex items-center justify-between pt-2">
            <div className="text-sm text-ink-dim tabular-nums">
              Gross: {gross.toLocaleString("en-US", { style: "currency", currency: form.currency, minimumFractionDigits: 2 })}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onCancel}
                className="rounded-md border border-line bg-bg-soft px-4 py-2 text-sm hover:border-ink-dim">Cancel</button>
              <button type="button" onClick={() => {
                if (!form.symbol.trim()) return;
                if (!parseFloat(form.quantity) || parseFloat(form.quantity) <= 0) return;
                onSubmit(form);
              }} disabled={loading || !canSubmit}
                className="rounded-md bg-brand text-white px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
                {loading ? "Saving…" : initial.symbol ? "Update" : "Add Transaction"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Transactions() {
  const qc = useQueryClient();
  const invalidateAll = useInvalidateAll();
  const { data: txData, isLoading } = useTransactions();
  const txs = txData?.transactions || [];
  const [search, setSearch] = useState("");
  const [sideFilter, setSideFilter] = useState("");
  const [ccyFilter, setCcyFilter] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortAsc, setSortAsc] = useState(false);
  const [modal, setModal] = useState<"add" | { edit: Tx } | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fundAliases, setFundAliases] = useState<{ alias: string; isin: string; fund_name: string }[]>([]);
  const [showManageAliases, setShowManageAliases] = useState(false);

  const filtered = useMemo(() => {
    let result = txs;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((t) =>
        t.symbol.toLowerCase().includes(q) ||
        (t.name || "").toLowerCase().includes(q) ||
        t.note.toLowerCase().includes(q)
      );
    }
    if (sideFilter) result = result.filter((t) => t.side === sideFilter);
    if (ccyFilter) result = result.filter((t) => t.currency === ccyFilter);
    return result;
  }, [txs, search, sideFilter, ccyFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "date": cmp = a.date.localeCompare(b.date); break;
        case "symbol": cmp = a.symbol.localeCompare(b.symbol); break;
        case "side": cmp = a.side.localeCompare(b.side); break;
        case "currency": cmp = a.currency.localeCompare(b.currency); break;
        case "quantity": cmp = a.quantity - b.quantity; break;
        case "price": cmp = a.price - b.price; break;
        case "gross_amount": cmp = a.gross_amount - b.gross_amount; break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === "date" || key === "symbol" || key === "side" || key === "currency"); }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown size={12} className="text-ink-faint" />;
    return sortAsc ? <ArrowUp size={12} className="text-brand" /> : <ArrowDown size={12} className="text-brand" />;
  };

  const toggleSelectAll = () => {
    if (selected.size === sorted.length) setSelected(new Set());
    else setSelected(new Set(sorted.map((t) => t.id!).filter(Boolean)));
  };

  const handleDeleteOne = async (tx: Tx) => {
    if (!confirm(`Delete ${tx.side} ${tx.quantity} ${tx.symbol} on ${tx.date}?`)) return;
    if (!tx.id) return;
    try {
      await api.deleteTransaction(tx.id);
      invalidateAll();
    } catch (e: any) { console.error(e); }
  };

  const handleBulkDelete = async () => {
    const ids = [...selected].filter(Boolean);
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} selected transaction${ids.length > 1 ? "s" : ""}? This cannot be undone.`)) return;
    try {
      setDeleting(true);
      await api.bulkDeleteTransactions(ids);
      setSelected(new Set());
      invalidateAll();
    } catch (e: any) { console.error(e); }
    finally { setDeleting(false); }
  };

  const [uploadResult, setUploadResult] = useState<{
    fileName: string;
    imported: number;
    skipped: number;
    errors: string[];
  } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    setUploadError(null);
    try {
      const r = await api.upload(f);
      setUploadResult({
        fileName: f.name,
        imported: r.imported,
        skipped: r.skipped,
        errors: r.errors || [],
      });
      invalidateAll();
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      e.target.value = "";
      setUploading(false);
    }
  };

  const downloadTemplate = () => {
    // Use the exact header names the parser accepts. Quantity is signed:
    // positive = buy, negative = sell. Side is also inferred from the sign
    // so both columns are optional, but we include both for clarity.
    const headers = [
      "Action", "Date", "Symbol", "Quantity", "Price",
      "Exchange", "Currency", "Fees", "Label", "Note",
    ];
    const rows = [
      ["BUY",  "2024-01-15", "AAPL",  "10",   "150.00", "USX",  "USD", "1.00", "US Market", "Apple Inc"],
      ["BUY",  "2024-02-03", "0700",  "100",  "320.00", "HKEX", "HKD", "5.00", "HK Market", "Tencent"],
      ["BUY",  "2024-03-20", "D05",   "50",   "38.50",  "SGX",  "SGD", "2.50", "SG Market", "DBS"],
      ["BUY",  "2024-04-10", "IWDA",  "20",   "85.00",  "LSE",  "GBP", "0.00", "UK Market", "iShares Core MSCI World"],
      ["SELL", "2024-05-05", "AAPL",  "-5",   "175.00", "USX",  "USD", "1.00", "US Market", "Partial trim"],
    ];
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(","))
      .join("\n") + "\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "transactions-template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Export the user's current transactions in the same format as the
  // upload template — round-trip safe (downloading + uploading reproduces
  // the same dataset). Filename is dated so multiple exports don't collide.
  const downloadTransactions = () => {
    if (txs.length === 0) {
      alert("No transactions to export.");
      return;
    }
    const headers = [
      "Action", "Date", "Symbol", "Quantity", "Price",
      "Exchange", "Currency", "Fees", "Label", "Note",
    ];
    const csvEscape = (s: any) => {
      const v = s == null ? "" : String(s);
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    };
    const rows = [...txs]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((t) => [
        t.side === "sell" ? "SELL" : "BUY",
        t.date,
        t.symbol,
        t.side === "sell" ? -Math.abs(t.quantity) : Math.abs(t.quantity),
        t.price,
        t.exchange,
        t.currency,
        t.fees ?? 0,
        t.label ?? "",
        t.note ?? "",
      ]);
    const csv = [headers, ...rows]
      .map((r) => r.map(csvEscape).join(","))
      .join("\n") + "\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const today = new Date().toISOString().slice(0, 10);
    a.download = `transactions-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSubmit = async (form: TxFormState) => {
    setFormError(null);
    if (!form.symbol.trim()) { setFormError("Symbol is required"); return; }
    const qty = parseFloat(form.quantity);
    const px = parseFloat(form.price);
    if (!qty || qty <= 0) { setFormError("Quantity must be > 0"); return; }
    if (px < 0) { setFormError("Price must be >= 0"); return; }
    setFormLoading(true);
    try {
      const payload = {
        date: form.date,
        side: form.side,
        symbol: form.symbol.trim().toUpperCase(),
        exchange: form.exchange,
        quantity: qty,
        price: px,
        currency: form.currency,
        fees: parseFloat(form.fees) || 0,
        label: form.label.trim(),
        note: form.note.trim(),
      };
      if (modal && typeof modal === "object" && "edit" in modal && modal.edit.id) {
        await api.updateTransaction(modal.edit.id, payload);
      } else {
        await api.addTransaction(payload);
      }
      setModal(null);
      invalidateAll();
    } catch (err: any) {
      setFormError(err.message || "Failed to save");
    } finally {
      setFormLoading(false);
    }
  };

  if (isLoading) return <LoadingScreen />;

  // Stats
  const buyCount = txs.filter((t) => t.side === "buy").length;
  const sellCount = txs.filter((t) => t.side === "sell").length;
  const totalInvested = txs.filter((t) => t.side === "buy").reduce((s, t) => s + toBase(t.gross_amount, t.currency), 0);
  const symbols = new Set(txs.map((t) => t.symbol));

  return (
    <div className="space-y-4">
      {/* Header + Stats */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Transactions</h1>
          <p className="text-ink-dim text-sm mt-1">
            {txs.length} transactions · {symbols.size} symbols · {buyCount} buys · {sellCount} sells · S${totalInvested.toLocaleString("en-US", { maximumFractionDigits: 0 })} invested
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button onClick={handleBulkDelete} disabled={deleting}
              className="flex items-center gap-1.5 rounded-md border border-bad/40 bg-bad/10 text-bad px-3 py-1.5 text-sm font-medium hover:bg-bad/20 disabled:opacity-60">
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Delete {selected.size}
            </button>
          )}
          <button
            onClick={downloadTemplate}
            title="Download a sample CSV with the correct columns"
            className="flex items-center gap-1.5 rounded-md border border-line bg-bg-card text-ink-dim px-3 py-1.5 text-sm font-medium hover:text-ink"
          >
            <Download size={14} />
            Template
          </button>
          <button
            onClick={downloadTransactions}
            title="Download your current transactions as a CSV (round-trip safe)"
            className="flex items-center gap-1.5 rounded-md border border-line bg-bg-card text-ink-dim px-3 py-1.5 text-sm font-medium hover:text-ink"
          >
            <FileDown size={14} />
            Download
          </button>
          <label className={`flex items-center gap-1.5 rounded-md border border-line bg-bg-card px-3 py-1.5 text-sm font-medium text-ink-dim hover:text-ink cursor-pointer ${uploading ? "opacity-60 pointer-events-none" : ""}`}>
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? "Uploading…" : "Upload CSV"}
            <input type="file" accept=".csv" hidden disabled={uploading} onChange={onUpload} />
          </label>
          <button onClick={async () => { const r = await api.listFundAliases(); setFundAliases(r.aliases); setShowManageAliases(true); }}
            className="flex items-center gap-1.5 rounded-md border border-line bg-bg-card text-ink-dim px-3 py-1.5 text-sm font-medium hover:text-ink">
            <Trash2 size={14} />
            Manage Funds
          </button>
          <button onClick={() => { setFormError(null); setModal("add"); }}
            className="flex items-center gap-1.5 rounded-md border border-good/40 bg-good/10 text-good px-3 py-1.5 text-sm font-medium hover:bg-good/20">
            <Plus size={14} />
            Add
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search symbol, name, note…"
          className="rounded-md border border-line bg-bg-card px-3 py-1.5 text-sm w-56"
        />
        <div className="flex gap-1 text-sm">
          {["", "buy", "sell"].map((s) => (
            <button key={s} onClick={() => setSideFilter(s)}
              className={`px-2 py-1 rounded ${sideFilter === s ? "bg-brand text-white" : "text-ink-dim hover:text-ink bg-bg-card border border-line"}`}>
              {s || "All"}
            </button>
          ))}
        </div>
        <select value={ccyFilter} onChange={(e) => setCcyFilter(e.target.value)}
          className="rounded-md border border-line bg-bg-card px-2 py-1.5 text-sm">
          <option value="">All currencies</option>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {search || sideFilter || ccyFilter ? (
          <button onClick={() => { setSearch(""); setSideFilter(""); setCcyFilter(""); }}
            className="text-sm text-ink-faint hover:text-ink">
            Clear filters
          </button>
        ) : null}
        <div className="ml-auto text-sm text-ink-faint">{filtered.length} shown</div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-line bg-bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-ink-faint text-sm uppercase bg-bg-soft border-b border-line">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input type="checkbox" checked={selected.size === sorted.length && sorted.length > 0}
                    onChange={toggleSelectAll} className="rounded" />
                </th>
                {(["date", "symbol", "side", "currency", "quantity", "price", "gross_amount"] as SortKey[]).map((k) => {
                  const hideOnMobile = k === "currency" || k === "quantity" || k === "price";
                  return (
                    <th key={k}
                      className={`px-3 py-2 font-medium cursor-pointer select-none hover:text-ink ${k === "gross_amount" ? "text-right" : "text-left"} ${hideOnMobile ? "hidden sm:table-cell" : ""} ${k === "currency" ? "hidden md:table-cell" : ""}`}
                      onClick={() => toggleSort(k)}>
                      <span className="inline-flex items-center gap-1">
                        {k === "gross_amount" ? "Gross" : k}
                        <SortIcon k={k} />
                      </span>
                    </th>
                  );
                })}
                <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Note</th>
                <th className="w-16 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {sorted.map((t) => (
                <tr key={t.id || `${t.symbol}-${t.date}-${t.quantity}`}
                  className={`hover:bg-bg-soft transition-colors ${selected.has(t.id!) ? "bg-brand/5" : ""}`}>
                  <td className="px-3 py-1.5">
                    <input type="checkbox" checked={selected.has(t.id!)}
                      onChange={() => {
                        const next = new Set(selected);
                        if (next.has(t.id!)) next.delete(t.id!);
                        else next.add(t.id!);
                        setSelected(next);
                      }} className="rounded" />
                  </td>
                  <td className="px-3 py-1.5 text-ink-dim whitespace-nowrap tabular-nums text-sm">{fmtDate(t.date)}</td>
                  <td className="px-3 py-1.5">
                    <div className="font-medium whitespace-nowrap leading-tight">{t.name || t.symbol}</div>
                    {t.name && <div className="text-ink-faint text-sm leading-tight truncate max-w-[160px] tabular-nums">{t.symbol}</div>}
                  </td>
                  <td className={`px-3 py-1.5 text-sm font-medium uppercase whitespace-nowrap ${t.side === "buy" ? "text-good" : "text-bad"}`}>
                    {t.side}
                  </td>
                  <td className="px-3 py-1.5 text-ink-faint text-sm font-medium hidden sm:table-cell">{t.currency}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap hidden sm:table-cell">{fmtNum(t.quantity, 2)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap hidden sm:table-cell">{fmtNum(t.price, 4)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                    <span className="text-ink-dim text-sm">{ccySymbol(t.currency)}</span>
                    {fmtNum(t.gross_amount, 2)}
                  </td>
                  <td className="px-3 py-1.5 text-ink-faint text-sm truncate max-w-[120px] hidden md:table-cell">{t.note || ""}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setFormError(null); setModal({ edit: t }); }}
                        className="p-1 rounded text-ink-faint hover:text-ink hover:bg-bg-soft" title="Edit">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => handleDeleteOne(t)}
                        className="p-1 rounded text-ink-faint hover:text-bad hover:bg-bad/10" title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {modal && (
        <TxForm
          initial={modal === "add" ? INITIAL_FORM : {
            date: modal.edit.date,
            side: modal.edit.side as "buy" | "sell",
            symbol: modal.edit.symbol,
            exchange: modal.edit.exchange,
            quantity: String(modal.edit.quantity),
            price: String(modal.edit.price),
            currency: modal.edit.currency,
            fees: String(modal.edit.fees),
            label: modal.edit.label,
            note: modal.edit.note,
          }}
          loading={formLoading}
          error={formError}
          onSubmit={handleSubmit}
          onCancel={() => setModal(null)}
        />
      )}

      {/* Fund Aliases management modal */}
      {showManageAliases && (
        <FundAliasManager
          aliases={fundAliases}
          onDelete={async (alias) => { await api.deleteFundAlias(alias); const r = await api.listFundAliases(); setFundAliases(r.aliases); }}
          onClose={() => setShowManageAliases(false)}
        />
      )}

      {/* Upload result modal */}
      {uploadResult && (
        <UploadResultModal
          result={uploadResult}
          onClose={() => setUploadResult(null)}
        />
      )}

      {/* Upload error modal */}
      {uploadError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setUploadError(null)} />
          <div className="relative rounded-lg border border-bad/40 bg-bg-card w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center gap-2 mb-2">
              <AlertOctagon size={18} className="text-bad" />
              <h2 className="text-sm font-semibold text-bad">Upload failed</h2>
            </div>
            <p className="text-sm text-ink-dim mb-4">{uploadError}</p>
            <div className="flex justify-end">
              <button
                onClick={() => setUploadError(null)}
                className="rounded-md border border-line bg-bg-soft px-3 py-1.5 text-sm hover:border-ink-dim"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function FundAliasManager({ aliases, onDelete, onClose }: {
  aliases: { alias: string; isin: string; fund_name: string }[];
  onDelete: (alias: string) => Promise<void>;
  onClose: () => void;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} />
      <div className="relative rounded-lg border border-line bg-bg-card w-full max-w-md max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <h2 className="text-sm font-semibold">Saved Funds</h2>
          <button onClick={onClose} className="text-ink-faint hover:text-ink"><X size={18} /></button>
        </div>
        {aliases.length === 0 ? (
          <div className="px-4 py-8 text-center text-ink-dim text-sm">No saved funds yet.</div>
        ) : (
          <div className="divide-y divide-line/50">
            {aliases.map((a) => (
              <div key={a.alias} className="flex items-center justify-between px-4 py-3 hover:bg-bg-soft">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm">{a.alias}</div>
                  <div className="text-sm text-ink-faint truncate"><span className="text-ink-dim">{a.isin}</span> · {a.fund_name}</div>
                </div>
                <button
                  onClick={async () => { setDeleting(a.alias); await onDelete(a.alias); setDeleting(null); }}
                  disabled={deleting === a.alias}
                  className="ml-3 shrink-0 p-1 rounded text-ink-faint hover:text-bad hover:bg-bad/10 disabled:opacity-40">
                  {deleting === a.alias ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


function UploadResultModal({ result, onClose }: {
  result: { fileName: string; imported: number; skipped: number; errors: string[] };
  onClose: () => void;
}) {
  const allOk = result.skipped === 0;
  const Icon = allOk ? CheckCircle2 : result.imported > 0 ? AlertTriangle : AlertOctagon;
  const tone = allOk ? "text-good" : result.imported > 0 ? "text-warn" : "text-bad";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative rounded-lg border border-line bg-bg-card w-full max-w-lg max-h-[85vh] overflow-hidden shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-line">
          <div className="flex items-center gap-2">
            <Icon size={18} className={tone} />
            <h2 className="text-sm font-semibold">
              {allOk ? "Upload complete" : result.imported > 0 ? "Upload finished with warnings" : "Upload failed"}
            </h2>
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="text-sm text-ink-dim">
            <span className="font-mono text-ink">{result.fileName}</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className={`rounded-lg border p-3 ${result.imported > 0 ? "border-good/30 bg-good/5" : "border-line bg-bg-soft/50"}`}>
              <div className="text-xs uppercase tracking-wide text-ink-faint">Imported</div>
              <div className={`text-2xl font-semibold tabular-nums mt-0.5 ${result.imported > 0 ? "text-good" : "text-ink-faint"}`}>
                {result.imported}
              </div>
              <div className="text-xs text-ink-faint">transactions added</div>
            </div>
            <div className={`rounded-lg border p-3 ${result.skipped > 0 ? "border-bad/30 bg-bad/5" : "border-line bg-bg-soft/50"}`}>
              <div className="text-xs uppercase tracking-wide text-ink-faint">Skipped</div>
              <div className={`text-2xl font-semibold tabular-nums mt-0.5 ${result.skipped > 0 ? "text-bad" : "text-ink-faint"}`}>
                {result.skipped}
              </div>
              <div className="text-xs text-ink-faint">rows with errors</div>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-ink-faint mb-2">
                First {result.errors.length} error{result.errors.length !== 1 ? "s" : ""}
              </div>
              <div className="rounded-md border border-bad/20 bg-bad/5 max-h-48 overflow-y-auto">
                <ul className="divide-y divide-bad/10">
                  {result.errors.map((e, i) => (
                    <li key={i} className="px-3 py-1.5 text-sm text-ink-dim flex gap-2">
                      <span className="text-bad shrink-0">•</span>
                      <span className="font-mono text-xs leading-snug">{e}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {result.skipped > result.errors.length && (
                <div className="text-xs text-ink-faint mt-1.5">
                  …and {result.skipped - result.errors.length} more. Fix the errors in your CSV and re-upload.
                </div>
              )}
            </div>
          )}

          {allOk && (
            <div className="text-sm text-ink-dim">
              All rows imported successfully.
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line bg-bg-soft/30">
          <button
            onClick={onClose}
            className="rounded-md border border-line bg-bg-soft px-4 py-1.5 text-sm hover:border-ink-dim"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

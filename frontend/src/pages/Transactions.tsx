import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Button, Card, CardContent, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, List, ListItem, ListItemText, MenuItem as MuiMenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import ReceiptLongOutlined from "@mui/icons-material/ReceiptLongOutlined";
import CloseRounded from "@mui/icons-material/CloseRounded";
import { api } from "../lib/api";
import { fmtMoney, fmtNum, fmtDate, ccySymbol } from "../lib/utils";
import { Trash2, Plus, Pencil, X, ArrowUpDown, ArrowUp, ArrowDown, Check, Loader2, Save, Upload, AlertOctagon, CheckCircle2, AlertTriangle, Download, FileDown } from "lucide-react";
import { qk, useTransactions, useInvalidateAll } from "../hooks/usePortfolio";
import { LoadingScreen } from "../components/LoadingScreen";
import MobileTable from "../components/MobileTable";
import ToolbarOverflow from "../components/ToolbarOverflow";
import PageHeader from "../components/ui/PageHeader";
import MetricCard from "../components/ui/MetricCard";

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
    <Dialog open onClose={onCancel} fullWidth maxWidth="sm" scroll="paper" slotProps={{ transition: { timeout: 0 } }}>
      <DialogTitle sx={{ fontSize: "0.9375rem", fontWeight: 700 }}>
        {initial.symbol ? "Edit transaction" : "Add transaction"}
        <IconButton onClick={onCancel} aria-label="Close" size="small" sx={{ position: "absolute", right: 12, top: 10 }}><CloseRounded fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: { xs: 1.5, sm: 2 }, bgcolor: "background.default" }}>
        {error && (
          <Alert severity="error" variant="outlined" sx={{ mb: 1.5 }}>{error}</Alert>
        )}
        <div className="material-legacy-form space-y-3">
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
      </DialogContent>
    </Dialog>
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

  const toggleSelectAll = useCallback(() => {
    if (selected.size === sorted.length) setSelected(new Set());
    else setSelected(new Set(sorted.map((t) => t.id!).filter(Boolean)));
  }, [selected.size, sorted]);

  const toggleSelected = useCallback((id: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleDeleteOne = useCallback(async (tx: Tx) => {
    if (!confirm(`Delete ${tx.side} ${tx.quantity} ${tx.symbol} on ${tx.date}?`)) return;
    if (!tx.id) return;
    try {
      await api.deleteTransaction(tx.id);
      invalidateAll();
    } catch (e: any) { console.error(e); }
  }, [invalidateAll]);

  const handleEdit = useCallback((tx: Tx) => {
    setFormError(null);
    setModal({ edit: tx });
  }, []);

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
      const editId = modal && typeof modal === "object" && "edit" in modal ? modal.edit.id : null;
      const isEdit = !!editId;
      const saved = isEdit
        ? await api.updateTransaction(editId, payload)
        : await api.addTransaction(payload);

      // Put the saved row into the active query immediately. The backend
      // refreshes prices/dividends in the background, so the table should not
      // wait for that slower work or a second round-trip to display the row.
      if (saved.transaction) {
        qc.setQueryData<{ transactions: Tx[]; count: number }>(qk.transactions, (current) => {
          if (!current) return current;
          const withoutSaved = current.transactions.filter((t) => t.id !== saved.transaction.id);
          const transactions = [saved.transaction as Tx, ...withoutSaved]
            .sort((a, b) => b.date.localeCompare(a.date));
          return {
            transactions,
            count: isEdit ? current.count : current.count + 1,
          };
        });
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
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <PageHeader
        title="Transactions"
        icon={<ReceiptLongOutlined />}
        subtitle={`${txs.length} transactions · ${symbols.size} symbols · ${buyCount} buys · ${sellCount} sells`}
        actions={
          <ToolbarOverflow
            primary={
              <>
                {selected.size > 0 && <Button size="small" color="error" variant="outlined" onClick={handleBulkDelete} disabled={deleting} startIcon={deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}>Delete {selected.size}</Button>}
                <Button size="small" color="success" variant="contained" onClick={() => { setFormError(null); setModal("add"); }} startIcon={<Plus size={14} />} sx={{ flex: { xs: 1, sm: "initial" }, minWidth: 0, whiteSpace: "nowrap" }}>Add transaction</Button>
              </>
            }
          secondary={
            <>
              <MenuItem
                onClick={downloadTemplate}
                title="Download a sample CSV with the correct columns"
                icon={<Download size={14} />}
                label="Template"
              />
              <MenuItem
                onClick={downloadTransactions}
                title="Download your current transactions as a CSV (round-trip safe)"
                icon={<FileDown size={14} />}
                label="Download"
              />
              <UploadMenuItem uploading={uploading} onUpload={onUpload} />
              <MenuItem
                onClick={async () => { const r = await api.listFundAliases(); setFundAliases(r.aliases); setShowManageAliases(true); }}
                icon={<Trash2 size={14} />}
                label="Manage Funds"
              />
            </>
          }
          />
        }
      />

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }, gap: 1.5 }}>
        <MetricCard label="Transactions" value={txs.length} supporting={`${filtered.length} match current filters`} tone="primary" icon={<ReceiptLongOutlined fontSize="small" />} />
        <MetricCard label="Symbols" value={symbols.size} supporting="unique instruments" />
        <MetricCard label="Buys / sells" value={`${buyCount} / ${sellCount}`} supporting="recorded trade legs" />
        <MetricCard label="Invested" value={fmtMoney(totalInvested, BASE_CCY)} supporting="estimated SGD base" tone="primary" />
      </Box>

      {/* Filters */}
      <Card variant="outlined">
        <CardContent sx={{ p: { xs: 1.25, sm: 1.5 }, "&:last-child": { pb: { xs: 1.25, sm: 1.5 } } }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { xs: "stretch", sm: "center" }, flexWrap: "wrap" }}>
        <TextField
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          label="Search"
          placeholder="Symbol, name, note"
          size="small"
          sx={{ width: { xs: "100%", sm: 230 } }}
        />
        <ToggleButtonGroup size="small" fullWidth exclusive value={sideFilter} onChange={(_, value) => setSideFilter(value || "")} aria-label="Transaction side filter" sx={{ width: { xs: "100%", sm: "auto" }, "& .MuiToggleButton-root": { flex: { xs: 1, sm: "initial" } } }}>
          <ToggleButton value="">All</ToggleButton><ToggleButton value="buy" color="success">Buy</ToggleButton><ToggleButton value="sell" color="error">Sell</ToggleButton>
        </ToggleButtonGroup>
        <TextField select size="small" label="Currency" value={ccyFilter} onChange={(e) => setCcyFilter(e.target.value)} sx={{ width: { xs: "100%", sm: 130 } }}>
          <MuiMenuItem value="">All currencies</MuiMenuItem>
          {CURRENCIES.map((currency) => <MuiMenuItem key={currency} value={currency}>{currency}</MuiMenuItem>)}
        </TextField>
          {search || sideFilter || ccyFilter ? (
            <Button size="small" color="inherit" onClick={() => { setSearch(""); setSideFilter(""); setCcyFilter(""); }}>Clear filters</Button>
          ) : null}
          <Typography variant="caption" color="text.secondary" sx={{ ml: { sm: "auto" } }}>{filtered.length} shown</Typography>
          </Stack>
        </CardContent>
      </Card>

      {/* Table + mobile card list */}
      {!modal && <Card variant="outlined" sx={{ overflow: "hidden", borderColor: { xs: "transparent", md: "divider" }, bgcolor: { xs: "transparent", md: "background.paper" } }}><MobileTable
        items={sorted}
        keyOf={(t) => t.id ?? `${t.symbol}-${t.date}-${t.quantity}`}
        empty="No transactions match the current filters."
        renderCard={(t) => {
          const isBuy = t.side === "buy";
          const isSelected = selected.has(t.id!);
          return (
          <Card variant="outlined" sx={{ borderColor: isSelected ? "primary.main" : "divider", borderWidth: isSelected ? 2 : 1 }}>
            <CardContent sx={{ p: 1.25, "&:last-child": { pb: 1.25 } }}>
              <Stack direction="row" sx={{ alignItems: "flex-start", gap: 0.75 }}>
                <Checkbox size="small" checked={isSelected} sx={{ p: 0.25, mt: 0.1 }} onChange={() => toggleSelected(t.id!)} slotProps={{ input: { "aria-label": `Select ${t.symbol}` } }} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Stack direction="row" spacing={0.6} sx={{ alignItems: "center", minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 750 }} noWrap>{t.symbol}</Typography>
                    <Chip size="small" label={isBuy ? "Buy" : "Sell"} color={isBuy ? "success" : "error"} variant="outlined" sx={{ height: 21, fontSize: "0.66rem", fontWeight: 700, "& .MuiChip-label": { px: 0.8 } }} />
                  </Stack>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", mt: 0.2 }}>{t.name || `${t.exchange} · ${t.currency}`} · {fmtDate(t.date)}</Typography>
                </Box>
                <Box sx={{ minWidth: 0, textAlign: "right", flexShrink: 0 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Gross</Typography>
                  <Typography variant="body2" sx={{ color: isBuy ? "success.main" : "error.main", fontWeight: 750, fontVariantNumeric: "tabular-nums" }} noWrap>{ccySymbol(t.currency)}{fmtNum(t.gross_amount, 2)}</Typography>
                </Box>
                <Stack direction="row" sx={{ flexShrink: 0, ml: 0.25 }}>
                  <IconButton size="small" title="Edit" aria-label={`Edit ${t.symbol}`} sx={{ minWidth: 30, minHeight: 30, p: 0.5 }} onClick={() => handleEdit(t)}><Pencil size={15} /></IconButton>
                  <IconButton size="small" title="Delete" aria-label={`Delete ${t.symbol}`} color="error" sx={{ minWidth: 30, minHeight: 30, p: 0.5 }} onClick={() => handleDeleteOne(t)}><Trash2 size={15} /></IconButton>
                </Stack>
              </Stack>
              <Divider sx={{ my: 1 }} />
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1 }}>
                <TxMetric label="Quantity" value={fmtNum(t.quantity, 2)} />
                <TxMetric label="Price" value={fmtNum(t.price, 4)} />
                <TxMetric label="Fees" value={`${ccySymbol(t.currency)}${fmtNum(t.fees, 2)}`} />
              </Box>
              {t.note && <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", mt: 0.9, pt: 0.75, borderTop: 1, borderColor: "divider" }}>{t.note}</Typography>}
            </CardContent>
          </Card>
          );
        }}
        renderTable={() => (
          <TableContainer sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ minWidth: 900 }}>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox"><Checkbox size="small" checked={selected.size === sorted.length && sorted.length > 0} indeterminate={selected.size > 0 && selected.size < sorted.length} onChange={toggleSelectAll} /></TableCell>
                  {(["date", "symbol", "side", "currency", "quantity", "price", "gross_amount"] as SortKey[]).map((key) => {
                    const hiddenOnSmall = key === "quantity" || key === "price";
                    const hiddenOnMedium = key === "currency";
                    const label = key === "gross_amount" ? "Gross" : key;
                    return (
                      <TableCell key={key} align={key === "gross_amount" || ["quantity", "price"].includes(key) ? "right" : "left"} sx={{ display: hiddenOnMedium ? { xs: "none", md: "table-cell" } : hiddenOnSmall ? { xs: "none", sm: "table-cell" } : undefined }}>
                        <TableSortLabel active={sortKey === key} direction={sortKey === key ? (sortAsc ? "asc" : "desc") : "asc"} onClick={() => toggleSort(key)}>{label}</TableSortLabel>
                      </TableCell>
                    );
                  })}
                  <TableCell sx={{ display: { xs: "none", md: "table-cell" } }}>Note</TableCell>
                  <TableCell padding="checkbox" />
                </TableRow>
              </TableHead>
              <TableBody>
                {sorted.map((t) => (
                  <TableRow key={t.id || `${t.symbol}-${t.date}-${t.quantity}`} hover selected={selected.has(t.id!)}>
                    <TableCell padding="checkbox"><Checkbox size="small" checked={selected.has(t.id!)} onChange={() => toggleSelected(t.id!)} /></TableCell>
                    <TableCell sx={{ color: "text.secondary", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmtDate(t.date)}</TableCell>
                    <TableCell><Typography variant="body2" sx={{ fontWeight: 650, whiteSpace: "nowrap" }}>{t.name || t.symbol}</Typography>{t.name && <Typography variant="caption" color="text.secondary">{t.symbol}</Typography>}</TableCell>
                    <TableCell><Chip size="small" label={t.side === "buy" ? "Buy" : "Sell"} color={t.side === "buy" ? "success" : "error"} variant="outlined" /></TableCell>
                    <TableCell sx={{ display: { xs: "none", sm: "table-cell" }, color: "text.secondary" }}>{t.currency}</TableCell>
                    <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" }, fontVariantNumeric: "tabular-nums" }}>{fmtNum(t.quantity, 2)}</TableCell>
                    <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" }, fontVariantNumeric: "tabular-nums" }}>{fmtNum(t.price, 4)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}><Typography component="span" variant="caption" color="text.secondary">{ccySymbol(t.currency)}</Typography>{fmtNum(t.gross_amount, 2)}</TableCell>
                    <TableCell sx={{ display: { xs: "none", md: "table-cell" }, maxWidth: 160 }}><Typography variant="body2" color="text.secondary" noWrap>{t.note || ""}</Typography></TableCell>
                    <TableCell padding="checkbox"><Stack direction="row"><IconButton size="small" title="Edit" onClick={() => handleEdit(t)}><Pencil size={15} /></IconButton><IconButton size="small" title="Delete" color="error" onClick={() => handleDeleteOne(t)}><Trash2 size={15} /></IconButton></Stack></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      /></Card>}

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
        <MaterialFundAliasManager
          aliases={fundAliases}
          onDelete={async (alias) => { await api.deleteFundAlias(alias); const r = await api.listFundAliases(); setFundAliases(r.aliases); }}
          onClose={() => setShowManageAliases(false)}
        />
      )}

      {/* Upload result modal */}
      {uploadResult && (
        <MaterialUploadResultModal
          result={uploadResult}
          onClose={() => setUploadResult(null)}
        />
      )}

      {/* Upload error modal */}
      {uploadError && <UploadErrorDialog message={uploadError} onClose={() => setUploadError(null)} />}
    </Box>
  );
}

function TxMetric({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }} noWrap>{label}</Typography>
      <Typography variant="body2" sx={{ mt: 0.15, fontWeight: 650, fontVariantNumeric: "tabular-nums" }} noWrap>{value}</Typography>
    </Box>
  );
}

function MenuItem({
  onClick,
  icon,
  label,
  title,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title?: string;
}) {
  return (
    <>
      <Button
        type="button"
        onClick={onClick}
        title={title}
        variant="text"
        color="inherit"
        startIcon={icon}
        sx={{ width: "100%", justifyContent: "flex-start", textAlign: "left", gap: 0.5, minHeight: 44, px: 1.5, borderRadius: 1, color: "text.primary", "& .MuiButton-startIcon": { color: "text.secondary", mr: 0.75 } }}
      >
        {label}
      </Button>
    </>
  );
}

function UploadMenuItem({
  uploading,
  onUpload,
}: {
  uploading: boolean;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
      <Button component="label" variant="text" color="inherit" disabled={uploading} startIcon={uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} sx={{ width: "100%", justifyContent: "flex-start", textAlign: "left", gap: 0.5, minHeight: 44, px: 1.5, borderRadius: 1, color: "text.primary", "& .MuiButton-startIcon": { color: "text.secondary", mr: 0.75 } }}>
        {uploading ? "Uploading…" : "Upload CSV"}
        <input type="file" accept=".csv" hidden disabled={uploading} onChange={onUpload} />
      </Button>
  );
}

function Mini({ label, value, align = "left" }: { label: string; value: string; align?: "left" | "right" }) {
  return (
    <div className={`min-w-0 ${align === "right" ? "text-right" : ""}`}>
      <div className="text-[10px] uppercase tracking-wider text-ink-faint leading-tight">{label}</div>
      <div className="text-sm font-medium tabular-nums truncate leading-tight">{value}</div>
    </div>
  );
}


function MaterialFundAliasManager({ aliases, onDelete, onClose }: {
  aliases: { alias: string; isin: string; fund_name: string }[];
  onDelete: (alias: string) => Promise<void>;
  onClose: () => void;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose} scroll="paper">
      <DialogTitle sx={{ fontWeight: 700, fontSize: "0.95rem" }}>
        Saved funds
        <IconButton onClick={onClose} aria-label="Close" size="small" sx={{ position: "absolute", right: 12, top: 10 }}><CloseRounded fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {aliases.length === 0 ? <Typography color="text.secondary" align="center" sx={{ py: 5 }}>No saved funds yet.</Typography> : (
          <List disablePadding>
            {aliases.map((a) => (
              <ListItem key={a.alias} divider secondaryAction={<IconButton edge="end" color="error" aria-label={`Delete ${a.alias}`} disabled={deleting === a.alias} onClick={async () => { setDeleting(a.alias); await onDelete(a.alias); setDeleting(null); }}>{deleting === a.alias ? <Loader2 size={16} className="spin-icon" /> : <Trash2 size={16} />}</IconButton>}>
                <ListItemText primary={<Typography variant="body2" sx={{ fontWeight: 700 }}>{a.alias}</Typography>} secondary={<Typography variant="body2" color="text.secondary" noWrap>{a.isin} · {a.fund_name}</Typography>} />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MaterialUploadResultModal({ result, onClose }: {
  result: { fileName: string; imported: number; skipped: number; errors: string[] };
  onClose: () => void;
}) {
  const allOk = result.skipped === 0;
  const Icon = allOk ? CheckCircle2 : result.imported > 0 ? AlertTriangle : AlertOctagon;
  const tone = allOk ? "success.main" : result.imported > 0 ? "warning.main" : "error.main";
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose} scroll="paper">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, fontWeight: 700, fontSize: "0.95rem" }}>
        <Box sx={{ display: "flex", color: tone }}><Icon size={19} /></Box>
        {allOk ? "Upload complete" : result.imported > 0 ? "Upload finished with warnings" : "Upload failed"}
        <IconButton onClick={onClose} aria-label="Close" size="small" sx={{ position: "absolute", right: 12, top: 10 }}><CloseRounded fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, overflowWrap: "anywhere" }}>{result.fileName}</Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1 }}>
          <Card variant="outlined" sx={{ bgcolor: result.imported > 0 ? (theme) => alpha(theme.palette.success.main, 0.08) : "action.hover" }}><CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}><Typography variant="caption" color="text.secondary">IMPORTED</Typography><Typography variant="h2" color={result.imported > 0 ? "success.main" : "text.secondary"} sx={{ mt: 0.25 }}>{result.imported}</Typography><Typography variant="caption" color="text.secondary">transactions added</Typography></CardContent></Card>
          <Card variant="outlined" sx={{ bgcolor: result.skipped > 0 ? (theme) => alpha(theme.palette.error.main, 0.08) : "action.hover" }}><CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}><Typography variant="caption" color="text.secondary">SKIPPED</Typography><Typography variant="h2" color={result.skipped > 0 ? "error.main" : "text.secondary"} sx={{ mt: 0.25 }}>{result.skipped}</Typography><Typography variant="caption" color="text.secondary">rows with errors</Typography></CardContent></Card>
        </Box>
        {result.errors.length > 0 && <Alert severity="warning" variant="outlined" sx={{ mt: 2, maxHeight: 220, overflow: "auto" }}><Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>Skipped rows</Typography><Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2 }}>{result.errors.map((error, index) => <Typography component="li" variant="caption" key={index}>{error}</Typography>)}</Stack>{result.skipped > result.errors.length && <Typography variant="caption" sx={{ display: "block", mt: 1 }}>…and {result.skipped - result.errors.length} more.</Typography>}</Alert>}
        {allOk && <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>All rows imported successfully.</Typography>}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}

function UploadErrorDialog({ message, onClose }: { message: string; onClose: () => void }) {
  return <Dialog open fullWidth maxWidth="xs" onClose={onClose}><DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, color: "error.main", fontWeight: 700, fontSize: "0.95rem" }}><AlertOctagon size={18} />Upload failed</DialogTitle><DialogContent><Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>{message}</Typography></DialogContent><DialogActions><Button onClick={onClose}>Close</Button></DialogActions></Dialog>;
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
            <span className="text-ink">{result.fileName}</span>
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
                      <span className="text-xs leading-snug">{e}</span>
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

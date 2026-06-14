import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

const EXCHANGES = ["USX", "HKEX", "LSE", "SGX", "SSB"] as const;
const CURRENCIES = ["USD", "SGD", "HKD", "GBP", "CNY"] as const;

interface FormState {
  date: string;
  side: "buy" | "sell";
  symbol: string;
  exchange: typeof EXCHANGES[number];
  quantity: string;
  price: string;
  currency: typeof CURRENCIES[number];
  fees: string;
  label: string;
  note: string;
}

const INITIAL: FormState = {
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

export default function AddTransaction() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.symbol.trim()) { setError("Symbol is required"); return; }
    const qty = parseFloat(form.quantity);
    const px = parseFloat(form.price);
    if (!qty || qty <= 0) { setError("Quantity must be > 0"); return; }
    if (px < 0) { setError("Price must be >= 0"); return; }

    setLoading(true);
    try {
      await api.addTransaction({
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
      });
      qc.invalidateQueries();
      navigate(-1);
    } catch (err: any) {
      setError(err.message || "Failed to add transaction");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Add Transaction</h1>
        <button onClick={() => navigate(-1)} className="text-sm text-ink-faint hover:text-ink">
          &larr; Back
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-bad/10 border border-bad/20 text-bad text-sm px-4 py-2">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-lg border border-line bg-bg-card p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-ink-faint mb-1">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={set("date")}
                className="w-full rounded-md border border-line bg-bg-soft px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-ink-faint mb-1">Side</label>
              <div className="flex gap-1">
                {(["buy", "sell"] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, side }))}
                    className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium capitalize transition-colors ${
                      form.side === side
                        ? side === "buy"
                          ? "bg-good/20 border-good text-good"
                          : "bg-bad/20 border-bad text-bad"
                        : "border-line bg-bg-soft text-ink-faint hover:border-ink-dim"
                    }`}
                  >
                    {side}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-ink-faint mb-1">Symbol *</label>
              <input
                type="text"
                value={form.symbol}
                onChange={set("symbol")}
                placeholder="e.g. AAPL, 9866"
                className="w-full rounded-md border border-line bg-bg-soft px-3 py-2 text-sm uppercase"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-ink-faint mb-1">Exchange</label>
              <select
                value={form.exchange}
                onChange={set("exchange")}
                className="w-full rounded-md border border-line bg-bg-soft px-3 py-2 text-sm"
              >
                {EXCHANGES.map((ex) => (
                  <option key={ex} value={ex}>{ex}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm text-ink-faint mb-1">Quantity *</label>
              <input
                type="number"
                value={form.quantity}
                onChange={set("quantity")}
                min="0"
                step="any"
                placeholder="0"
                className="w-full rounded-md border border-line bg-bg-soft px-3 py-2 text-sm tabular-nums"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-ink-faint mb-1">Price *</label>
              <input
                type="number"
                value={form.price}
                onChange={set("price")}
                min="0"
                step="any"
                placeholder="0.00"
                className="w-full rounded-md border border-line bg-bg-soft px-3 py-2 text-sm tabular-nums"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-ink-faint mb-1">Fees</label>
              <input
                type="number"
                value={form.fees}
                onChange={set("fees")}
                min="0"
                step="any"
                placeholder="0.00"
                className="w-full rounded-md border border-line bg-bg-soft px-3 py-2 text-sm tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-ink-faint mb-1">Currency</label>
              <select
                value={form.currency}
                onChange={set("currency")}
                className="w-full rounded-md border border-line bg-bg-soft px-3 py-2 text-sm"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-ink-faint mb-1">Label</label>
              <input
                type="text"
                value={form.label}
                onChange={set("label")}
                placeholder="e.g. US Market"
                className="w-full rounded-md border border-line bg-bg-soft px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-ink-faint mb-1">Note</label>
            <textarea
              value={form.note}
              onChange={set("note")}
              rows={2}
              placeholder="Optional note"
              className="w-full rounded-md border border-line bg-bg-soft px-3 py-2 text-sm resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-sm text-ink-faint">
            Gross: {((parseFloat(form.quantity) || 0) * (parseFloat(form.price) || 0)).toLocaleString("en-US", {
              style: "currency",
              currency: form.currency,
              minimumFractionDigits: 2,
            })}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="rounded-md border border-line bg-bg-soft px-4 py-2 text-sm hover:border-ink-dim"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-brand text-white px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Adding…" : "Add Transaction"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
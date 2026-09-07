import { useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Button, Card, CardContent, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import AddCircleOutlineRounded from "@mui/icons-material/AddCircleOutlineRounded";
import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
import { api } from "../lib/api";
import PageHeader from "../components/ui/PageHeader";

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
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof FormState) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((current) => ({ ...current, [field]: event.target.value }));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!form.symbol.trim()) { setError("Symbol is required"); return; }
    const quantity = parseFloat(form.quantity);
    const price = parseFloat(form.price);
    if (!quantity || quantity <= 0) { setError("Quantity must be greater than zero"); return; }
    if (price < 0) { setError("Price must be zero or greater"); return; }

    setLoading(true);
    try {
      await api.addTransaction({
        date: form.date,
        side: form.side,
        symbol: form.symbol.trim().toUpperCase(),
        exchange: form.exchange,
        quantity,
        price,
        currency: form.currency,
        fees: parseFloat(form.fees) || 0,
        label: form.label.trim(),
        note: form.note.trim(),
      });
      queryClient.invalidateQueries();
      navigate(-1);
    } catch (err: any) {
      setError(err.message || "Failed to add transaction");
    } finally {
      setLoading(false);
    }
  };

  const gross = (parseFloat(form.quantity) || 0) * (parseFloat(form.price) || 0);

  return (
    <Box sx={{ maxWidth: 760, mx: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
      <PageHeader title="Add transaction" subtitle="Record a broker transaction and rebuild FIFO lots." icon={<AddCircleOutlineRounded />} actions={<Button size="small" color="inherit" startIcon={<ArrowBackRounded />} onClick={() => navigate(-1)}>Back</Button>} />
      {error && <Alert severity="error" variant="outlined">{error}</Alert>}
      <Card variant="outlined">
        <CardContent sx={{ p: { xs: 1.5, sm: 2.5 } }}>
          <Box component="form" onSubmit={handleSubmit}>
            <Stack spacing={2}>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
                <TextField type="date" label="Date" value={form.date} onChange={set("date")} slotProps={{ inputLabel: { shrink: true } }} required />
                <Box><Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>Side</Typography><ToggleButtonGroup exclusive fullWidth value={form.side} onChange={(_, side) => side && setForm((current) => ({ ...current, side }))} size="small"><ToggleButton value="buy" color="success">Buy</ToggleButton><ToggleButton value="sell" color="error">Sell</ToggleButton></ToggleButtonGroup></Box>
              </Box>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
                <TextField label="Symbol" value={form.symbol} onChange={set("symbol")} placeholder="AAPL, 9866" slotProps={{ htmlInput: { style: { textTransform: "uppercase" } } }} required />
                <TextField select label="Exchange" value={form.exchange} onChange={set("exchange")}>
                  {EXCHANGES.map((exchange) => <MenuItem key={exchange} value={exchange}>{exchange}</MenuItem>)}
                </TextField>
              </Box>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" }, gap: 1.5 }}>
                <TextField type="number" label="Quantity" value={form.quantity} onChange={set("quantity")} slotProps={{ htmlInput: { min: 0, step: "any" } }} required />
                <TextField type="number" label="Price" value={form.price} onChange={set("price")} slotProps={{ htmlInput: { min: 0, step: "any" } }} required />
                <TextField type="number" label="Fees" value={form.fees} onChange={set("fees")} slotProps={{ htmlInput: { min: 0, step: "any" } }} />
              </Box>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
                <TextField select label="Currency" value={form.currency} onChange={set("currency")}>
                  {CURRENCIES.map((currency) => <MenuItem key={currency} value={currency}>{currency}</MenuItem>)}
                </TextField>
                <TextField label="Label" value={form.label} onChange={set("label")} placeholder="US Market" />
              </Box>
              <TextField label="Note" value={form.note} onChange={set("note")} placeholder="Optional note" multiline minRows={2} />
              <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: { xs: "stretch", sm: "center" }, gap: 1.5, flexDirection: { xs: "column", sm: "row" } }}>
                <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>Gross: {gross.toLocaleString("en-US", { style: "currency", currency: form.currency, minimumFractionDigits: 2 })}</Typography>
                <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}><Button type="button" color="inherit" onClick={() => navigate(-1)}>Cancel</Button><Button type="submit" variant="contained" disabled={loading}>{loading ? "Adding…" : "Add transaction"}</Button></Stack>
              </Stack>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

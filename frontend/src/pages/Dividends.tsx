import { useMemo, useState, type ReactNode } from "react";
import { Accordion, AccordionDetails, AccordionSummary, Box, Card, CardContent, Chip, LinearProgress, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography } from "@mui/material";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import { fmtDate, ccySymbol, fmtMoneyFull, fmtPct, fmtNum } from "../lib/utils";
import { Coins, Building2, ArrowUpRight, ArrowDownRight, ChevronDown, ChevronUp, BarChart3, Calendar, Wallet, TrendingUp, ListChecks } from "lucide-react";
import { useDividends, useHoldings } from "../hooks/usePortfolio";
import { LoadingScreen } from "../components/LoadingScreen";
import MobileTable from "../components/MobileTable";
import PageHeader from "../components/ui/PageHeader";
import MetricCard from "../components/ui/MetricCard";

const BASE_CCY = "SGD";

const CCY_COLORS: Record<string, string> = {
  SGD: "warning.main",
  USD: "primary.main",
  HKD: "success.main",
  GBP: "error.main",
  CNY: "info.main",
};

function colorForCcy(ccy: string) {
  return CCY_COLORS[ccy] || "text.disabled";
}

type CardId = "kpi" | "monthly" | "yearly" | "payers" | "currency";

export default function Dividends() {
  const { data: divData, isLoading } = useDividends();
  const { data: holdingsData } = useHoldings();
  const [ccyFilter, setCcyFilter] = useState<string>("ALL");
  const [transactionSearch, setTransactionSearch] = useState("");
  // Default the snapshot card open.
  const [openCard, setOpenCard] = useState<CardId | "">("kpi");

  const toggleCard = (id: CardId) => {
    setOpenCard((curr) => (curr === id ? "" : id) as CardId);
  };


  const data = divData;
  const events = data?.events || [];
  const summary = data?.summary || {};
  const totalSgd = summary.total_received_base || 0;
  const bySymbol = summary.by_symbol || [];

  // Holdings → symbol→{market_value_native, dividends_native, currency, name}
  const holdingsBySym = useMemo(() => {
    const m: Record<string, { market_value: number; dividends_received: number; currency: string; name: string }> = {};
    for (const h of holdingsData?.holdings || []) {
      m[h.symbol.toUpperCase()] = {
        market_value: h.market_value || 0,
        dividends_received: h.dividends_received || 0,
        currency: h.currency,
        name: h.name || "",
      };
    }
    return m;
  }, [holdingsData]);

  // Last full year's dividends per symbol (in native currency, for yield calc)
  const lastFullYear = (() => {
    const now = new Date();
    return String(now.getFullYear() - 1);
  })();
  const lastYearDivsBySym = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of events) {
      const y = (e.ex_date || "").slice(0, 4);
      if (y !== lastFullYear) continue;
      m[e.symbol.toUpperCase()] = (m[e.symbol.toUpperCase()] || 0) + (e.total_received || 0);
    }
    return m;
  }, [events, lastFullYear]);

  // Currencies present, sorted by total native descending
  const ccys = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of events) m[e.currency] = (m[e.currency] || 0) + (e.total_received || 0);
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => c);
  }, [events]);

  // All years across all currencies
  const allYears = useMemo(() => {
    const s = new Set<string>();
    for (const e of events) {
      const y = (e.ex_date || "").slice(0, 4);
      if (y) s.add(y);
    }
    return Array.from(s).sort();
  }, [events]);

  const yearTotalsSgd = summary.by_year_base || {};
  const avgMonthlyLastFullYear = Number(yearTotalsSgd[lastFullYear] || 0) / 12;
  const maxYearSgd = Math.max(...Object.values(yearTotalsSgd).map((v) => Number(v)), 1);

  // Per-currency per-year for the stacked bar. Each event already carries
  // its own SGD conversion based on the event's ex-date FX rate.
  const byYearCcySgd = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const e of events) {
      const y = (e.ex_date || "").slice(0, 4);
      if (!y) continue;
      if (!m[y]) m[y] = {};
      m[y][e.currency] = (m[y][e.currency] || 0) + (e.total_received_base || 0);
    }
    return m;
  }, [events]);

  const monthlySgd = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of events) {
      const d = new Date(e.ex_date);
      if (isNaN(d.getTime())) continue;
      const y = String(d.getFullYear());
      const k = `${y}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      m[k] = (m[k] || 0) + (e.total_received_base || 0);
    }
    return m;
  }, [events]);

  const monthlySorted = useMemo(
    () => Object.entries(monthlySgd).sort(([a], [b]) => a.localeCompare(b)),
    [monthlySgd],
  );
  const last12Months = monthlySorted.slice(-12);
  const maxMonthSgd = Math.max(...last12Months.map(([, v]) => v), 1);

  // YoY comparison — YTD vs same period last year (month-by-month)
  const currentYear = new Date().getFullYear().toString();
  const lastYear = (new Date().getFullYear() - 1).toString();
  const currentMonth = new Date().getMonth();
  const ytdSgd = Number(yearTotalsSgd[currentYear] || 0);
  const lastYtdSgd = monthlySorted
    .filter(([k]) => k.startsWith(lastYear + "-"))
    .filter(([k]) => Number(k.slice(5, 7)) - 1 <= currentMonth)
    .reduce((s, [, v]) => s + v, 0);
  const yoyChange = lastYtdSgd > 0 ? (ytdSgd - lastYtdSgd) / lastYtdSgd : 0;

  // Symbol → name lookup
  const nameBySym = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of events) {
      if (e.name && !m[e.symbol.toUpperCase()]) m[e.symbol.toUpperCase()] = e.name;
    }
    for (const [sym, h] of Object.entries(holdingsBySym)) {
      if (h.name && !m[sym]) m[sym] = h.name;
    }
    return m;
  }, [events, holdingsBySym]);

  const bySymbolWithName = useMemo(() => {
    return bySymbol.map((s: any) => ({
      ...s,
      name: s.name || nameBySym[s.symbol.toUpperCase()] || "",
    }));
  }, [bySymbol, nameBySym]);

  const topPayer = useMemo(() => {
    if (!bySymbolWithName.length) return null;
    const withYield = bySymbolWithName.map((s: any) => {
      const sym = s.symbol.toUpperCase();
      const h = holdingsBySym[sym];
      const annualDivs = lastYearDivsBySym[sym] ?? 0;
      const yieldPct = h && h.market_value > 0 ? annualDivs / h.market_value : 0;
      return { ...s, yieldPct, annualDivs };
    });
    const hasYield = withYield.some((s: any) => s.yieldPct > 0);
    if (!hasYield) return bySymbolWithName[0];
    return withYield.sort((a: any, b: any) => b.yieldPct - a.yieldPct)[0];
  }, [bySymbolWithName, holdingsBySym, lastYearDivsBySym]);
  const topPayerPct = topPayer?.yieldPct ?? 0;

  const perCcyBySymbol = useMemo(() => {
    const m: Record<string, Record<string, { total: number; events: number; name: string; totalSgd: number }>> = {};
    for (const e of events) {
      const ccy = e.currency;
      const sym = e.symbol;
      if (!m[ccy]) m[ccy] = {};
      if (!m[ccy][sym]) m[ccy][sym] = { total: 0, events: 0, name: e.name || "", totalSgd: 0 };
      m[ccy][sym].total += e.total_received || 0;
      m[ccy][sym].totalSgd += e.total_received_base || 0;
      m[ccy][sym].events += 1;
      if (!m[ccy][sym].name && e.name) m[ccy][sym].name = e.name;
    }
    return m;
  }, [events]);

  const filteredEvents = useMemo(() => {
    const query = transactionSearch.trim().toLowerCase();
    return events.filter((e: any) => {
      if (ccyFilter !== "ALL" && e.currency !== ccyFilter) return false;
      if (query && !e.symbol.toLowerCase().includes(query) && !(e.name || "").toLowerCase().includes(query)) return false;
      return true;
    });
  }, [events, ccyFilter, transactionSearch]);

  if (isLoading) return <LoadingScreen />;
  if (!data) return <div>No data</div>;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, minHeight: { lg: "calc(100vh - 96px)" } }}>
      <PageHeader
        title="Dividends"
        icon={<Coins size={20} />}
        subtitle={`${summary.events_count || 0} events · ${bySymbol.length} payers · ${ccys.length} currencies`}
      />

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }, gap: 1.5 }}>
        <MetricCard label="Lifetime" value={fmtMoneyFull(totalSgd, BASE_CCY)} supporting="net dividends received" tone="warning" icon={<Coins size={16} />} />
        <MetricCard label={`YTD ${currentYear}`} value={fmtMoneyFull(ytdSgd, BASE_CCY)} supporting={lastYtdSgd > 0 ? `${fmtPct(yoyChange, 1)} vs ${lastYear}` : "current year"} tone={yoyChange >= 0 ? "success" : "error"} />
        <MetricCard label="Top payer" value={topPayer ? (topPayer.name || topPayer.symbol) : "—"} supporting={topPayer ? `${fmtPct(topPayerPct, 2)} yield · ${lastFullYear}` : "No payer data"} tone="primary" />
        <MetricCard label="Avg / month" value={fmtMoneyFull(avgMonthlyLastFullYear, BASE_CCY)} supporting={`${lastFullYear} total ÷ 12 months`} />
      </Box>

      {/* === Mobile: transactions only (full width) === */}
      {/* === Desktop: 2-column layout: Left = transactions, Right = accordion cards === */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 2fr) minmax(300px, 1fr)" }, gap: 1.5, flex: { lg: 1 }, minHeight: { lg: 0 } }}>
        {/* LEFT — All dividend transactions */}
        <Card variant="outlined" sx={{ overflow: "hidden", display: "flex", flexDirection: "column", minHeight: { lg: 0 } }}>
          <Stack direction="row" sx={{ px: 1.25, py: 0.75, alignItems: "center", justifyContent: "space-between", gap: 1, bgcolor: "action.hover", borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
            {/* Section title is redundant on mobile (the page header already
                says "Dividends"); only show it when we're in the 2-column
                desktop layout. The currency filter chips stay visible on
                both layouts. */}
            <Typography variant="caption" sx={{ display: { xs: "none", lg: "flex" }, alignItems: "center", gap: 0.75, fontWeight: 700, whiteSpace: "nowrap" }}>
              <Box sx={{ color: "warning.main", display: "flex" }}><ListChecks size={13} /></Box>
              All dividend transactions
            </Typography>
            <TextField
              size="small"
              value={transactionSearch}
              onChange={(event) => setTransactionSearch(event.target.value)}
              placeholder="Search symbol or name"
              aria-label="Search dividend transactions"
              sx={{ width: { xs: 145, sm: 190 }, flexShrink: 0, "& .MuiInputBase-root": { height: 28, fontSize: "0.72rem" }, "& input": { py: 0.5 } }}
            />
            <Stack direction="row" spacing={0.5} sx={{ overflowX: "auto", whiteSpace: "nowrap", minWidth: 0, ml: { xs: 0, lg: "auto" } }}>
              <Chip
                onClick={() => setCcyFilter("ALL")}
                label={`All (${events.length})`}
                size="small"
                color={ccyFilter === "ALL" ? "warning" : "default"}
                variant={ccyFilter === "ALL" ? "filled" : "outlined"}
                sx={{ height: 22, fontSize: "0.68rem", "& .MuiChip-label": { px: 0.75 } }}
              />
              {ccys.map((c) => {
                const count = events.filter((e: any) => e.currency === c).length;
                return (
                  <Chip
                    key={c}
                    onClick={() => setCcyFilter(c)}
                    label={`${c} (${count})`}
                    size="small"
                    color={ccyFilter === c ? "warning" : "default"}
                    variant={ccyFilter === c ? "filled" : "outlined"}
                    sx={{ height: 22, fontSize: "0.68rem", "& .MuiChip-label": { px: 0.75 } }}
                  />
                );
              })}
            </Stack>
          </Stack>
          <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <MobileTable
              items={filteredEvents}
              keyOf={(e: any, i: number) => `${e.symbol}-${e.ex_date}-${i}`}
              empty="No dividend events"
              renderCard={(e: any) => (
                <Card variant="outlined">
                  <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
                    <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start", gap: 1 }}>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline", minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{e.symbol}</Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 650 }}>{e.currency}</Typography>
                        </Stack>
                        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", mt: 0.15 }}>{e.name || "Dividend event"}</Typography>
                      </Box>
                      <Box sx={{ textAlign: "right", flexShrink: 0 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Received</Typography>
                        <Typography variant="body1" sx={{ color: "success.main", fontWeight: 750, fontVariantNumeric: "tabular-nums" }}>{ccySymbol(e.currency)}{e.total_received.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>= {fmtMoneyFull(e.total_received_base || 0, BASE_CCY)}</Typography>
                      </Box>
                    </Stack>
                    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 0.75, mt: 1.25, pt: 1, borderTop: 1, borderColor: "divider" }}>
                      <Box sx={{ minWidth: 0 }}><Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: "0.62rem" }}>Ex-date</Typography><Typography variant="caption" sx={{ fontWeight: 650, fontVariantNumeric: "tabular-nums" }} noWrap>{fmtDate(e.ex_date)}</Typography></Box>
                      <Box sx={{ minWidth: 0 }}><Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: "0.62rem" }}>Shares</Typography><Typography variant="caption" sx={{ fontWeight: 650, fontVariantNumeric: "tabular-nums" }} noWrap>{e.shares_at_ex.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Typography></Box>
                      <Box sx={{ minWidth: 0 }}><Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: "0.62rem" }}>Per share</Typography><Typography variant="caption" sx={{ fontWeight: 650, fontVariantNumeric: "tabular-nums" }} noWrap>{ccySymbol(e.currency)}{e.amount_per_share.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</Typography></Box>
                    </Box>
                  </CardContent>
                </Card>
              )}
              renderTable={() => (
                <TableContainer sx={{ overflowX: "auto" }}>
                  <Table size="small" stickyHeader sx={{ minWidth: 680 }}>
                    <TableHead><TableRow><TableCell>Ex-date</TableCell><TableCell>Symbol</TableCell><TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }}>Shares</TableCell><TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }}>Per share</TableCell><TableCell align="right">Received</TableCell><TableCell align="right">In {BASE_CCY}</TableCell></TableRow></TableHead>
                    <TableBody>
                      {filteredEvents.map((e: any, i: number) => (
                        <TableRow key={`${e.symbol}-${e.ex_date}-${i}`} hover>
                          <TableCell sx={{ color: "text.secondary", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmtDate(e.ex_date)}</TableCell>
                          <TableCell><Typography variant="body2" sx={{ fontWeight: 650, whiteSpace: "nowrap" }}>{e.name || e.symbol}</Typography>{e.name && <Typography variant="caption" color="text.secondary">{e.symbol}</Typography>}</TableCell>
                          <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" }, fontVariantNumeric: "tabular-nums" }}>{e.shares_at_ex.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                          <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" }, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>{ccySymbol(e.currency)}{e.amount_per_share.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 650, fontVariantNumeric: "tabular-nums" }}><Typography component="span" sx={{ color: "success.main", fontWeight: 700 }}>{ccySymbol(e.currency)}{e.total_received.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Typography></TableCell>
                          <TableCell align="right" sx={{ fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>{fmtMoneyFull(e.total_received_base || 0, BASE_CCY)}</TableCell>
                        </TableRow>
                      ))}
                      {filteredEvents.length === 0 && <TableRow><TableCell colSpan={6} align="center"><Typography variant="body2" color="text.secondary">No dividend events</Typography></TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            />
          </Box>
        </Card>

        {/* RIGHT — Accordion cards (desktop only).
            Sticky so it stays in view as the left table scrolls internally,
            and `self-start` so the column doesn't stretch to fill the grid
            track (which would visually stretch the Snapshot card). */}
        <Box sx={{ alignSelf: "start", minWidth: 0, position: { lg: "sticky" }, top: { lg: 16 }, maxHeight: { lg: "calc(100vh - 8rem)" }, overflowY: { lg: "auto" }, pr: { lg: 0.5 }, display: { xs: "none", lg: "flex" }, flexDirection: "column", gap: 1 }}>
          {/* Card 1: KPI snapshot */}
          <AccordionCard
            id="kpi"
            title="Snapshot"
            icon={<BarChart3 size={13} />}
            open={openCard === "kpi"}
            onToggle={() => toggleCard("kpi")}
          >
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1 }}>
              <SideMetric label="Lifetime" value={fmtMoneyFull(totalSgd, BASE_CCY)} tone="warning.main" />
              <SideMetric
                label={`YTD ${currentYear}`}
                value={fmtMoneyFull(ytdSgd, BASE_CCY)}
                detail={lastYtdSgd > 0 ? <Stack direction="row" spacing={0.25} sx={{ alignItems: "center" }}><span>{yoyChange >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}</span>{fmtPct(yoyChange, 1)} vs {lastYear}</Stack> : undefined}
                tone={lastYtdSgd > 0 ? (yoyChange >= 0 ? "success.main" : "error.main") : undefined}
              />
              <SideMetric label="Top payer" value={topPayer ? (topPayer.name || topPayer.symbol) : "—"} detail={topPayer ? `${fmtPct(topPayerPct, 2)} yield · ${lastFullYear}` : undefined} tone="warning.main" />
              <SideMetric label="Avg / month" value={fmtMoneyFull(avgMonthlyLastFullYear, BASE_CCY)} detail={`${lastFullYear} total ÷ 12 months`} />
            </Box>
          </AccordionCard>

          {/* Card 2: Monthly trend */}
          {last12Months.length > 0 && (
            <AccordionCard
              id="monthly"
              title="Monthly trend"
              icon={<TrendingUp size={13} />}
              open={openCard === "monthly"}
              onToggle={() => toggleCard("monthly")}
              badge={`last ${last12Months.length} mo`}
            >
                    <Box sx={{ display: "flex", alignItems: "stretch", gap: 0.5, height: 160 }}>
                      {last12Months.map(([k, v]) => {
                  const pct = (v / maxMonthSgd) * 100;
                  const [y, m] = k.split("-");
                  const monthLabel = new Date(Number(y), Number(m) - 1).toLocaleString("en-US", { month: "short" });
                  const isCurrentMonth = k === last12Months[last12Months.length - 1][0];
                  return (
                          <Tooltip key={k} title={`${monthLabel} ${y}: ${fmtMoneyFull(v, BASE_CCY)}`} arrow placement="top" enterTouchDelay={0}>
                            <Box sx={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "stretch", cursor: "help" }}>
                            <Box sx={{ height: `${Math.max(pct, 1)}%`, minHeight: 2, bgcolor: isCurrentMonth ? "warning.main" : "warning.light", opacity: isCurrentMonth ? 1 : 0.45, borderRadius: "4px 4px 0 0", transition: "opacity 160ms" }} />
                            <Typography variant="caption" color="text.secondary" align="center" sx={{ fontSize: "0.58rem", mt: 0.35, lineHeight: 1 }}>{monthLabel}</Typography>
                            </Box>
                          </Tooltip>
                  );
                })}
              </Box>
            </AccordionCard>
          )}

          {/* Card 3: Year stacked */}
          {allYears.length > 0 && (
            <AccordionCard
              id="yearly"
              title="By year · stacked"
              icon={<Calendar size={13} />}
              open={openCard === "yearly"}
              onToggle={() => toggleCard("yearly")}
              badge={
                <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                  {ccys.map((c) => (
                    <Stack key={c} direction="row" spacing={0.35} sx={{ alignItems: "center" }}><Box sx={{ width: 7, height: 7, borderRadius: 0.75, bgcolor: colorForCcy(c) }} /><Typography variant="caption" sx={{ fontWeight: 650 }}>{c}</Typography></Stack>
                  ))}
                </Stack>
              }
            >
              <Stack spacing={0.75}>
                {allYears.map((y) => {
                  const sgd = Number(yearTotalsSgd[y] || 0);
                  const byCcy = byYearCcySgd[y] || {};
                  return (
                    <Stack key={y} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <Typography variant="caption" color="text.secondary" sx={{ width: 34, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{y}</Typography>
                      <Box sx={{ flex: 1, height: 14, borderRadius: 1, bgcolor: "action.hover", overflow: "hidden", display: "flex" }}>
                        {ccys.map((c) => {
                          const v = byCcy[c] || 0;
                          if (v <= 0) return null;
                          const pct = (v / maxYearSgd) * 100;
                          return (
                            <Box
                              key={c}
                              sx={{ width: `${pct}%`, bgcolor: colorForCcy(c), height: "100%" }}
                              title={`${c} ${fmtMoneyFull(v, BASE_CCY)}`}
                            />
                          );
                        })}
                      </Box>
                      <Typography variant="caption" align="right" sx={{ width: 86, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                        {fmtMoneyFull(sgd, BASE_CCY)}
                      </Typography>
                    </Stack>
                  );
                })}
              </Stack>
            </AccordionCard>
          )}

          {/* Card 4: Top payers */}
          {bySymbolWithName.length > 0 && (
            <AccordionCard
              id="payers"
              title="Top payers"
              icon={<Building2 size={13} />}
              open={openCard === "payers"}
              onToggle={() => toggleCard("payers")}
              badge={`by ${lastFullYear} yield`}
            >
              <Stack divider={<Box sx={{ borderBottom: 1, borderColor: "divider" }} />}>
                {bySymbolWithName
                  .map((s: any) => {
                    const sym = s.symbol.toUpperCase();
                    const h = holdingsBySym[sym];
                    const annualDivs = lastYearDivsBySym[sym] ?? 0;
                    const yieldPct = h && h.market_value > 0 ? annualDivs / h.market_value : 0;
                    return { ...s, yieldPct };
                  })
                  .sort((a: any, b: any) => b.yieldPct - a.yieldPct)
                  .slice(0, 8)
                  .map((s: any, i: number) => {
                    const maxYield = Math.max(...bySymbolWithName.map((x: any) => {
                      const sym = x.symbol.toUpperCase();
                      const h = holdingsBySym[sym];
                      return h && h.market_value > 0 ? (lastYearDivsBySym[sym] ?? 0) / h.market_value : 0;
                    }), 0.01);
                    const pctBar = s.yieldPct / maxYield;
                    return (
                      <Stack key={s.symbol} direction="row" spacing={1} sx={{ py: 0.9, alignItems: "center", minWidth: 0 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ width: 16, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{i + 1}</Typography>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "baseline", gap: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 650 }} noWrap>{s.name || s.symbol}</Typography>
                            <Typography variant="caption" color="warning.main" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtPct(s.yieldPct, 2)}</Typography>
                          </Stack>
                          {s.name && <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>{s.symbol}</Typography>}
                          <LinearProgress variant="determinate" value={Math.min(pctBar * 100, 100)} sx={{ height: 3, mt: 0.5, borderRadius: 2, bgcolor: "action.hover", "& .MuiLinearProgress-bar": { bgcolor: "warning.main" } }} />
                        </Box>
                      </Stack>
                    );
                  })}
              </Stack>
            </AccordionCard>
          )}

          {/* Card 5: By currency */}
          {ccys.length > 0 && (
            <AccordionCard
              id="currency"
              title="By currency"
              icon={<Wallet size={13} />}
              open={openCard === "currency"}
              onToggle={() => toggleCard("currency")}
              badge="native totals"
            >
              <Stack divider={<Box sx={{ borderBottom: 1, borderColor: "divider" }} />}>
                {ccys.map((ccy) => {
                  const syms = Object.entries(perCcyBySymbol[ccy] || {})
                    .sort((a, b) => b[1].total - a[1].total);
                  const ccyTotal = syms.reduce((sum, [, v]) => sum + v.total, 0);
                  const ccyTotalSgd = syms.reduce((sum, [, v]) => sum + v.totalSgd, 0);
                  const sym = ccySymbol(ccy);
                  const eventCount = syms.reduce((s, [, v]) => s + v.events, 0);
                    return (
                      <Box key={ccy} sx={{ py: 1 }}>
                        <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", gap: 1, mb: 0.75 }}>
                          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", minWidth: 0 }}>
                            <Box sx={{ width: 7, height: 7, borderRadius: 0.75, bgcolor: colorForCcy(ccy), flexShrink: 0 }} />
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>{ccy}</Typography>
                            <Typography variant="caption" color="text.secondary" noWrap>· {syms.length} payers · {eventCount} events</Typography>
                          </Stack>
                          <Box sx={{ textAlign: "right", flexShrink: 0 }}><Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{sym} {ccyTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Typography><Typography variant="caption" color="warning.main" sx={{ fontVariantNumeric: "tabular-nums" }}>= {fmtMoneyFull(ccyTotalSgd, BASE_CCY)}</Typography></Box>
                        </Stack>
                        <Stack spacing={0.5}>
                          {syms.slice(0, 3).map(([s, info]) => (
                            <Stack key={s} direction="row" sx={{ justifyContent: "space-between", alignItems: "center", gap: 1, minWidth: 0 }}><Typography variant="caption" sx={{ fontWeight: 650 }} noWrap>{info.name || s}{info.name && <Typography component="span" variant="caption" color="text.secondary"> {s}</Typography>}</Typography><Stack direction="row" spacing={1} sx={{ alignItems: "center", flexShrink: 0 }}><Typography variant="caption" color="text.secondary">{info.events}×</Typography><Typography variant="caption" color="warning.main" sx={{ fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>{sym} {info.total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Typography></Stack></Stack>
                          ))}
                          {syms.length > 3 && <Typography variant="caption" color="text.secondary">+{syms.length - 3} more</Typography>}
                        </Stack>
                      </Box>
                    );
                  })}
              </Stack>
            </AccordionCard>
          )}
        </Box>
      </Box>
    </Box>
  );
}

function SideMetric({ label, value, detail, tone = "text.primary" }: { label: string; value: ReactNode; detail?: ReactNode; tone?: string }) {
  return (
    <Box sx={{ minWidth: 0, p: 1, border: 1, borderColor: "divider", bgcolor: "action.hover", borderRadius: 1.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }} noWrap>{label}</Typography>
      <Typography variant="body2" color={tone} sx={{ mt: 0.35, fontWeight: 700, fontVariantNumeric: "tabular-nums" }} noWrap>{value}</Typography>
      {detail && <Typography variant="caption" color={tone} sx={{ display: "block", mt: 0.15, fontVariantNumeric: "tabular-nums" }} noWrap>{detail}</Typography>}
    </Box>
  );
}

function AccordionCard({
  id,
  title,
  icon,
  open,
  onToggle,
  badge,
  children,
}: {
  id: CardId;
  title: string;
  icon?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Accordion expanded={open} onChange={(_, expanded) => { if (expanded !== open) onToggle(); }} disableGutters>
      <AccordionSummary expandIcon={<ExpandMoreRounded />} sx={{ minHeight: 46, "& .MuiAccordionSummary-content": { my: 1 } }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", width: "100%" }}>
          <Box sx={{ color: "warning.main", display: "flex" }}>{icon}</Box>
          <Typography variant="body2" sx={{ fontWeight: 700, flex: 1 }}>{title}</Typography>
          {badge && <Typography variant="caption" color="text.secondary">{badge}</Typography>}
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0.5, pb: 1.5 }}>{children}</AccordionDetails>
    </Accordion>
  );
}

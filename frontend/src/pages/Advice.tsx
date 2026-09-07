import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Divider,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import AutoAwesomeOutlined from "@mui/icons-material/AutoAwesomeOutlined";
import CloseRounded from "@mui/icons-material/CloseRounded";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import LightbulbOutlined from "@mui/icons-material/LightbulbOutlined";
import PsychologyOutlined from "@mui/icons-material/PsychologyOutlined";
import RefreshRounded from "@mui/icons-material/RefreshRounded";
import SendRounded from "@mui/icons-material/SendRounded";
import StopCircleOutlined from "@mui/icons-material/StopCircleOutlined";
import WarningAmberOutlined from "@mui/icons-material/WarningAmberOutlined";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../lib/api";
import { fmtMoney, fmtPct, fmtNum } from "../lib/utils";
import { useDashboard } from "../hooks/usePortfolio";
import { useAdviceStreamStore, type AdviceReport } from "../stores/adviceStream";
import { useStore } from "../stores/useStore";
import PageHeader from "../components/ui/PageHeader";
import MetricCard from "../components/ui/MetricCard";

const ADVICE_KEY = ["advice", "full"] as const;

function lsKey(userId: string | undefined, suffix: string): string {
  return `equity-ark-advice-cache-v1:${userId ?? "anon"}:${suffix}`;
}

const LEGACY_LS_KEYS = [
  "equity-ark-advice-cache-v1",
  "equity-ark-advice-cache-v1:q",
  "equity-ark-advice-cache-v1:qt",
];

if (typeof window !== "undefined") {
  try {
    for (const key of LEGACY_LS_KEYS) localStorage.removeItem(key);
  } catch {
    // Ignore unavailable local storage.
  }
}

function readPersistedReport(userId: string | undefined): AdviceReport | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(lsKey(userId, "default"));
    if (!raw) return undefined;
    const report = JSON.parse(raw) as AdviceReport;
    if (!report.generated_at) return undefined;
    return Date.now() - new Date(report.generated_at).getTime() <= 24 * 60 * 60 * 1000 ? report : undefined;
  } catch {
    return undefined;
  }
}

function writePersistedReport(userId: string | undefined, report: AdviceReport) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(lsKey(userId, "default"), JSON.stringify(report));
  } catch {
    // Ignore quota errors.
  }
}

function stripOuterCodeFence(markdown: string): string {
  const match = markdown.match(/^\s*```(?:markdown|md|mdx|text)?\s*\n([\s\S]*?)\n```\s*$/);
  return match ? match[1] : markdown;
}

const markdownTableComponents = {
  table: ({ children }: { children?: ReactNode }) => (
    <TableContainer sx={{ overflowX: "auto", my: 1.5 }}>
      <Table size="small" sx={{ minWidth: 560 }}>{children}</Table>
    </TableContainer>
  ),
  thead: ({ children }: { children?: ReactNode }) => <TableHead>{children}</TableHead>,
  tbody: ({ children }: { children?: ReactNode }) => <TableBody>{children}</TableBody>,
  tr: ({ children }: { children?: ReactNode }) => <TableRow hover>{children}</TableRow>,
  th: ({ children }: { children?: ReactNode }) => <TableCell component="th" scope="col" sx={{ fontWeight: 700 }}>{children}</TableCell>,
  td: ({ children }: { children?: ReactNode }) => <TableCell sx={{ fontVariantNumeric: "tabular-nums" }}>{children}</TableCell>,
};

export default function Advice() {
  const [question, setQuestion] = useState("");
  const [askBusy, setAskBusy] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(true);
  const askRef = useRef<HTMLTextAreaElement>(null);
  const thinkingScrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const userId = useStore((state) => state.user?.id);

  const streaming = useAdviceStreamStore((state) => state.streaming);
  const streamThinking = useAdviceStreamStore((state) => state.thinking);
  const streamContent = useAdviceStreamStore((state) => state.content);
  const streamSource = useAdviceStreamStore((state) => state.source);
  const streamingQuestion = useAdviceStreamStore((state) => state.question);
  const streamError = useAdviceStreamStore((state) => state.error);
  const lastReport = useAdviceStreamStore((state) => state.lastReport);
  const streamVersion = useAdviceStreamStore((state) => state.version);
  const startStream = useAdviceStreamStore((state) => state.start);
  const stopStream = useAdviceStreamStore((state) => state.stop);
  const setActiveQuestion = useAdviceStreamStore((state) => state.setActiveQuestion);

  const { data: report, isLoading: loading } = useQuery<AdviceReport>({
    queryKey: ADVICE_KEY,
    queryFn: () => api.advice("full", undefined, false) as Promise<AdviceReport>,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
    initialData: () => readPersistedReport(userId),
  });

  const [questionAnswer, setQuestionAnswer] = useState<AdviceReport | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(lsKey(userId, "q"));
      if (!raw) return null;
      const value = JSON.parse(raw) as AdviceReport;
      return Date.now() - new Date(value.generated_at).getTime() < 24 * 60 * 60 * 1000 ? value : null;
    } catch {
      return null;
    }
  });
  const [activeQuestionText, setActiveQuestionText] = useState(() => {
    if (typeof window === "undefined") return "";
    try { return localStorage.getItem(lsKey(userId, "qt")) || ""; } catch { return ""; }
  });

  useEffect(() => {
    setQuestionAnswer(null);
    setActiveQuestionText("");
    setQuestion("");
    queryClient.removeQueries({ queryKey: ADVICE_KEY });
  }, [userId, queryClient]);

  useEffect(() => {
    if (report && !report.question) writePersistedReport(userId, report);
  }, [report, userId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (questionAnswer) localStorage.setItem(lsKey(userId, "q"), JSON.stringify(questionAnswer));
      else localStorage.removeItem(lsKey(userId, "q"));
    } catch { /* ignore */ }
  }, [questionAnswer, userId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (activeQuestionText) localStorage.setItem(lsKey(userId, "qt"), activeQuestionText);
      else localStorage.removeItem(lsKey(userId, "qt"));
    } catch { /* ignore */ }
  }, [activeQuestionText, userId]);

  useEffect(() => {
    if (streaming || !lastReport) return;
    if (lastReport.question) {
      setQuestionAnswer(lastReport);
      setActiveQuestionText(lastReport.question);
      setActiveQuestion(lastReport.question);
    } else {
      queryClient.setQueryData(ADVICE_KEY, lastReport);
    }
    // The generated timestamp is the stream completion identifier.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, lastReport?.generated_at]);

  const { data: dashboard } = useDashboard();
  const summary = dashboard?.summary as any;
  const breakdown = dashboard?.breakdown as any;
  const metrics = summary && breakdown ? {
    netWorth: breakdown.totals?.current_value ?? 0,
    capital: breakdown.totals?.capital ?? 0,
    dayChange: summary.day_change ?? 0,
    dayChangePct: summary.day_change_pct ?? 0,
    twr: breakdown.header?.twr ?? 0,
    xirr: breakdown.header?.xirr ?? 0,
    positions: summary.holdings_count ?? 0,
  } : null;

  useEffect(() => {
    if (report) return;
    const timer = setTimeout(() => {
      const state = useAdviceStreamStore.getState();
      if (!state.streaming && !state.lastReport && !askBusy) startStream(undefined).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function regenerate() {
    setActiveQuestionText("");
    setActiveQuestion("");
    setQuestionAnswer(null);
    await startStream(undefined).catch(() => {});
  }

  async function ask(value: string) {
    if (!value.trim()) return;
    setAskBusy(true);
    try { await startStream(value); } finally { setAskBusy(false); }
  }

  function clearQuestion() {
    setActiveQuestion("");
    setActiveQuestionText("");
    setQuestionAnswer(null);
  }

  const userScrolledUpRef = useRef(false);
  useEffect(() => {
    const element = thinkingScrollRef.current;
    if (!element) return;
    const onScroll = () => {
      userScrolledUpRef.current = element.scrollHeight - element.scrollTop - element.clientHeight >= 30;
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [streaming, thinkingOpen]);

  useEffect(() => {
    const element = thinkingScrollRef.current;
    if (element && !userScrolledUpRef.current) element.scrollTop = element.scrollHeight;
  }, [streamThinking, thinkingOpen, streaming, streamVersion]);

  const baseReport: AdviceReport | null = questionAnswer ?? report ?? null;
  const displayReport: AdviceReport | null = streaming ? {
    generated_at: new Date().toISOString(),
    summary: streamContent.split("\n").find((line) => line.trim() && !line.startsWith("#")) || "Streaming…",
    sections: [],
    risk_flags: baseReport?.risk_flags ?? [],
    opportunities: baseReport?.opportunities ?? [],
    raw_markdown: streamContent,
    source: streamSource ?? "llm",
    question: streamingQuestion ?? undefined,
  } : baseReport;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <PageHeader
        title="AI Advisor"
        icon={<AutoAwesomeOutlined />}
        subtitle="Grounded analysis from live holdings, transactions, and dividend cash flows."
        actions={displayReport && <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: { xs: "flex-start", sm: "flex-end" }, flexWrap: "wrap" }}>
          {activeQuestionText && !streaming && <Chip icon={<PsychologyOutlined />} label={`Q: ${activeQuestionText}`} onDelete={clearQuestion} color="info" variant="outlined" sx={{ maxWidth: 260 }} />}
          <Chip size="small" label={displayReport.source === "llm" ? "LLM" : "Rule-based"} color={displayReport.source === "llm" ? "primary" : "default"} variant="outlined" />
          <Typography variant="caption" color="text.secondary">{new Date(displayReport.generated_at).toLocaleString()}</Typography>
          <IconButton size="small" onClick={regenerate} disabled={streaming} title="Regenerate"><RefreshRounded fontSize="small" className={streaming ? "spin-icon" : undefined} /></IconButton>
        </Stack>}
      />

      {metrics && <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", md: "repeat(3, 1fr)", xl: "repeat(6, 1fr)" }, gap: 1.5 }}>
        <MetricCard label="Net worth" value={fmtMoney(metrics.netWorth, "SGD")} tone="primary" />
        <MetricCard label="Capital" value={fmtMoney(metrics.capital, "SGD")} />
        <MetricCard label="Today" value={fmtMoney(metrics.dayChange, "SGD")} meta={fmtPct(metrics.dayChangePct, 2)} tone={metrics.dayChange >= 0 ? "success" : "error"} />
        <MetricCard label="TWR" value={fmtPct(metrics.twr, 2)} tone={metrics.twr >= 0 ? "success" : "error"} />
        <MetricCard label="XIRR" value={fmtPct(metrics.xirr, 2)} tone={metrics.xirr >= 0 ? "success" : "error"} />
        <MetricCard label="Positions" value={fmtNum(metrics.positions, 0)} />
      </Box>}

      <Card variant="outlined" sx={{ borderColor: "primary.main", background: "linear-gradient(135deg, rgba(96,165,250,0.09), transparent 65%)" }}>
        <CardContent sx={{ p: { xs: 1.5, sm: 2 }, "&:last-child": { pb: { xs: 1.5, sm: 2 } } }}>
          <Box component="form" onSubmit={(event) => { event.preventDefault(); ask(question); }}>
            <TextField
              fullWidth
              multiline
              minRows={2}
              inputRef={askRef}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(question); } }}
              placeholder="Ask anything about your portfolio…"
              helperText="Press Enter to ask · Shift + Enter for a new line"
            />
            <Stack direction="row" sx={{ justifyContent: "flex-end", gap: 1, mt: 1 }}>
              {question && <Button type="button" size="small" color="inherit" onClick={() => setQuestion("")}>Clear</Button>}
              <Button type="submit" variant="contained" disabled={askBusy || !question.trim()} startIcon={<SendRounded />}>{askBusy ? "Thinking…" : "Ask advisor"}</Button>
            </Stack>
          </Box>
        </CardContent>
      </Card>

      {streamError && <Alert severity="error" variant="outlined">{streamError}</Alert>}

      {loading && !displayReport && !streaming && <Card variant="outlined"><CardContent sx={{ py: 5, textAlign: "center" }}><AutoAwesomeOutlined color="primary" sx={{ fontSize: 36, mb: 1 }} /><Typography variant="h3">No AI report yet</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>Generate a fresh analysis and watch the advisor reason through your portfolio.</Typography><Button variant="contained" onClick={() => startStream(undefined).catch(() => {})} startIcon={<AutoAwesomeOutlined />}>Generate AI report</Button></CardContent></Card>}

      {streaming && <Card variant="outlined" sx={{ borderColor: "info.main" }}>
        <Stack direction="row" sx={{ alignItems: "center", px: 1.5, py: 1, gap: 1 }}>
          <PsychologyOutlined color="info" fontSize="small" />
          <Typography variant="body2" color="info.main" sx={{ fontWeight: 700 }}>AI thinking</Typography>
          {streamingQuestion && <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: "40ch" }}>· {streamingQuestion}</Typography>}
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption" color="text.secondary">{streamThinking.length} chars</Typography>
          <Button size="small" color="inherit" onClick={stopStream} startIcon={<StopCircleOutlined fontSize="small" />}>Stop</Button>
          <IconButton size="small" onClick={() => setThinkingOpen((open) => !open)} aria-label="Toggle thinking details"><ExpandMoreRounded sx={{ transform: thinkingOpen ? "rotate(180deg)" : "none", transition: "transform 160ms" }} /></IconButton>
        </Stack>
        <Collapse in={thinkingOpen}>
          <Box ref={thinkingScrollRef} sx={{ borderTop: 1, borderColor: "divider", px: 1.5, py: 1.5, maxHeight: 256, overflow: "auto", whiteSpace: "pre-wrap", fontSize: "0.75rem", color: "text.secondary" }}>{streamThinking || "…connecting to AI advisor…"}</Box>
        </Collapse>
      </Card>}

      {displayReport && <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        {(displayReport.risk_flags?.length > 0 || displayReport.opportunities?.length > 0) && <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" }, gap: 1.5 }}>
          {displayReport.risk_flags?.length > 0 && <Alert severity="error" variant="outlined" icon={<WarningAmberOutlined />}><Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>Risk flags ({displayReport.risk_flags.length})</Typography><Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2 }}>{displayReport.risk_flags.map((flag, index) => <Typography component="li" variant="body2" key={index}>{flag}</Typography>)}</Stack></Alert>}
          {displayReport.opportunities?.length > 0 && <Alert severity="success" variant="outlined" icon={<LightbulbOutlined />}><Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>Opportunities ({displayReport.opportunities.length})</Typography><Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2 }}>{displayReport.opportunities.map((opportunity, index) => <Typography component="li" variant="body2" key={index}>{opportunity}</Typography>)}</Stack></Alert>}
        </Box>}

        <Card variant="outlined">
          <CardContent sx={{ p: { xs: 1.5, sm: 2.5 } }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Full report</Typography>
            <Box className="prose prose-invert prose-sm" sx={{ mt: 1.5, maxWidth: "none" }}>
              {displayReport.raw_markdown ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownTableComponents}>{stripOuterCodeFence(displayReport.raw_markdown)}</ReactMarkdown> : <Typography variant="body2" color="text.secondary">…waiting for content…</Typography>}
              {streaming && <Box component="span" sx={{ display: "inline-block", width: 6, height: 16, bgcolor: "primary.main", ml: 0.5, verticalAlign: "middle", animation: "pulse 1s infinite" }} />}
            </Box>
          </CardContent>
        </Card>
        <Typography variant="caption" color="text.secondary" align="center">Educational analysis only. Not personalised financial advice. Past performance does not guarantee future results.</Typography>
      </Box>}
    </Box>
  );
}

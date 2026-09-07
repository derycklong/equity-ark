import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Sparkles, AlertTriangle, Lightbulb, Send, Loader2, X, RefreshCw, Brain, ChevronDown, ChevronUp } from "lucide-react";
import { fmtMoney, fmtPct, fmtNum } from "../lib/utils";
import { useDashboard } from "../hooks/usePortfolio";
import { useAdviceStreamStore, type AdviceReport } from "../stores/adviceStream";
import { useStore } from "../stores/useStore";

const ADVICE_KEY = ["advice", "full"] as const;
// localStorage keys are namespaced by user_id so two users on the same
// browser don't see each other's cached reports.
function lsKey(userId: string | undefined, suffix: string): string {
  return `equity-ark-advice-cache-v1:${userId ?? "anon"}:${suffix}`;
}

// Old, non-namespaced keys from previous versions — these would let any
// logged-in user see whoever's report was last cached on this browser.
// Delete them on first load so they can't leak.
const LEGACY_LS_KEYS = [
  "equity-ark-advice-cache-v1",
  "equity-ark-advice-cache-v1:q",
  "equity-ark-advice-cache-v1:qt",
];
if (typeof window !== "undefined") {
  try {
    for (const k of LEGACY_LS_KEYS) localStorage.removeItem(k);
  } catch { /* ignore */ }
}

function readPersistedReport(userId: string | undefined): AdviceReport | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(lsKey(userId, "default"));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as AdviceReport;
    if (!parsed.generated_at) return undefined;
    const age = Date.now() - new Date(parsed.generated_at).getTime();
    if (age > 24 * 60 * 60 * 1000) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function writePersistedReport(userId: string | undefined, r: AdviceReport) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(lsKey(userId, "default"), JSON.stringify(r));
  } catch {
    /* quota exceeded etc. — ignore */
  }
}

/**
 * Strip an outer ```markdown ... ``` (or ``` ... ```) fence from the LLM's
 * response. Sometimes the model wraps its entire reply in a fenced code
 * block, which would otherwise render as one giant <pre><code> with the
 * markdown syntax visible instead of parsed.
 *
 * Handles:
 *   ```markdown\n...\n```
 *   ```\n...\n```
 *   ```md\n...\n```
 * Leaves anything that isn't a single outer fence untouched.
 */
function stripOuterCodeFence(md: string): string {
  if (!md) return md;
  // Match a single opening ```<lang>? and a matching closing ``` at the very end.
  const m = md.match(/^\s*```(?:markdown|md|mdx|text)?\s*\n([\s\S]*?)\n```\s*$/);
  if (m) return m[1];
  return md;
}


export default function Advice() {
  const [question, setQuestion] = useState("");
  const [askBusy, setAskBusy] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(true);
  const askRef = useRef<HTMLTextAreaElement>(null);
  const thinkingScrollRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const userId = useStore((s) => s.user?.id);

  // All streaming state lives in the singleton — survives navigation.
  const streaming = useAdviceStreamStore((s) => s.streaming);
  const streamThinking = useAdviceStreamStore((s) => s.thinking);
  const streamContent = useAdviceStreamStore((s) => s.content);
  const streamSource = useAdviceStreamStore((s) => s.source);
  const streamingQuestion = useAdviceStreamStore((s) => s.question);
  const streamError = useAdviceStreamStore((s) => s.error);
  const lastReport = useAdviceStreamStore((s) => s.lastReport);
  const streamVersion = useAdviceStreamStore((s) => s.version);
  const startStream = useAdviceStreamStore((s) => s.start);
  const stopStream = useAdviceStreamStore((s) => s.stop);
  const setActiveQuestion = useAdviceStreamStore((s) => s.setActiveQuestion);

  const {
    data: report,
    isLoading: loading,
  } = useQuery<AdviceReport>({
    queryKey: ADVICE_KEY,
    queryFn: () => api.advice("full", undefined, false) as Promise<AdviceReport>,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
    initialData: () => readPersistedReport(userId),
  });

  // The answer to the active question (if any). Persisted to localStorage
  // so navigating away and back keeps the user's last answer.
  const [questionAnswer, setQuestionAnswer] = useState<AdviceReport | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(lsKey(userId, "q"));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AdviceReport;
      const age = Date.now() - new Date(parsed.generated_at).getTime();
      return age < 24 * 60 * 60 * 1000 ? parsed : null;
    } catch { return null; }
  });
  const [activeQuestionText, setActiveQuestionText] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try { return localStorage.getItem(lsKey(userId, "qt")) || ""; } catch { return ""; }
  });

  // When the user changes (login/logout/switch account), drop the local
  // state AND the React Query cache so the new user starts fresh —
  // the per-user backend cache will repopulate on the next fetch.
  useEffect(() => {
    setQuestionAnswer(null);
    setActiveQuestionText("");
    setQuestion("");
    qc.removeQueries({ queryKey: ADVICE_KEY });
  }, [userId, qc]);

  // Persist default report to localStorage whenever it changes.
  useEffect(() => {
    if (report && !report.question) writePersistedReport(userId, report);
  }, [report, userId]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (questionAnswer) localStorage.setItem(lsKey(userId, "q"), JSON.stringify(questionAnswer));
      else localStorage.removeItem(lsKey(userId, "q"));
    } catch {}
  }, [questionAnswer, userId]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (activeQuestionText) localStorage.setItem(lsKey(userId, "qt"), activeQuestionText);
      else localStorage.removeItem(lsKey(userId, "qt"));
    } catch {}
  }, [activeQuestionText, userId]);

  // When a stream finishes, commit its report to the appropriate slot.
  // Runs only on the Advice page (it's effect-scoped). If the user is on
  // another page, the singleton has already received the final report; this
  // effect just catches up when they navigate back.
  useEffect(() => {
    if (streaming) return;
    if (!lastReport) return;
    if (lastReport.question) {
      setQuestionAnswer(lastReport);
      setActiveQuestionText(lastReport.question);
      setActiveQuestion(lastReport.question);
    } else {
      qc.setQueryData(ADVICE_KEY, lastReport);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, lastReport?.generated_at]);

  const { data: dashData } = useDashboard();
  const m = dashData?.summary as any;
  const b = dashData?.breakdown as any;
  const metrics = m && b ? {
    netWorth: b.totals?.current_value ?? 0,
    capital: b.totals?.capital ?? 0,
    dayChange: m.day_change ?? 0,
    dayChangePct: m.day_change_pct ?? 0,
    twr: b.header?.twr ?? 0,
    xirr: b.header?.xirr ?? 0,
    positions: m.holdings_count ?? 0,
  } : null;

  // On first mount: if we don't already have a cached report and the React
  // Query fetch hasn't returned within a short grace period, kick off the
  // streaming flow so the user sees the "AI thinking" panel immediately.
  // (Skips auto-start if there's already an active stream — e.g. the user
  // navigated away and back while the AI was still thinking.)
  useEffect(() => {
    if (report) return;
    const cached = qc.getQueryData<AdviceReport>(ADVICE_KEY);
    if (cached) return;
    const t = setTimeout(() => {
      const s = useAdviceStreamStore.getState();
      if (!report && !s.streaming && !s.lastReport && !askBusy) {
        startStream(undefined).catch(() => { /* error surfaced via store */ });
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function regenerate() {
    setActiveQuestionText("");
    setActiveQuestion("");
    setQuestionAnswer(null);
    try {
      await startStream(undefined);
    } catch { /* error surfaced via store */ }
  }

  async function ask(q: string) {
    if (!q.trim()) return;
    setAskBusy(true);
    try {
      await startStream(q);
    } finally {
      setAskBusy(false);
    }
  }

  function clearQuestion() {
    setActiveQuestion("");
    setActiveQuestionText("");
    setQuestionAnswer(null);
  }

  // Auto-scroll the thinking panel to the bottom as content streams in.
  const userScrolledUpRef = useRef(false);
  useEffect(() => {
    const el = thinkingScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
      userScrolledUpRef.current = !atBottom;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [streaming, thinkingOpen]);
  useEffect(() => {
    const el = thinkingScrollRef.current;
    if (!el) return;
    if (userScrolledUpRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [streamThinking, thinkingOpen, streaming, streamVersion]);

  // What to show in the report body: live stream > question answer > default report.
  const baseReport: AdviceReport | null = questionAnswer ?? report ?? null;
  const displayReport: AdviceReport | null = streaming
    ? {
        generated_at: new Date().toISOString(),
        summary: streamContent.split("\n").find((l) => l.trim() && !l.startsWith("#")) || "Streaming…",
        sections: [],
        risk_flags: baseReport?.risk_flags ?? [],
        opportunities: baseReport?.opportunities ?? [],
        raw_markdown: streamContent,
        source: streamSource ?? "llm",
        question: streamingQuestion ?? undefined,
      }
    : baseReport;

  return (
    <div className="space-y-3">
      {/* === Header === */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Sparkles size={20} className="text-accent" />
            AI Advisor
            {streaming && (
              <span className="inline-flex items-center gap-1.5 text-xs font-normal text-info">
                <Loader2 size={12} className="animate-spin" />
                thinking…
              </span>
            )}
          </h1>
          <p className="text-ink-dim text-sm mt-0.5">
            Grounded analysis from your live holdings, transactions, and dividend cash flows.
          </p>
        </div>
        {displayReport && (
          <div className="flex items-center gap-2 text-xs flex-wrap">
            {activeQuestionText && !streaming && (
              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-info/10 text-info">
                <Brain size={11} />
                <span className="max-w-[40ch] truncate">Q: {activeQuestionText}</span>
                <button
                  onClick={clearQuestion}
                  title="Back to default report"
                  className="ml-1 p-0.5 rounded hover:bg-info/20"
                >
                  <X size={11} />
                </button>
              </span>
            )}
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
              displayReport.source === "llm" ? "bg-accent/10 text-accent" : "bg-bg-card text-ink-faint border border-line"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${displayReport.source === "llm" ? "bg-accent" : "bg-ink-faint"}`} />
              {displayReport.source === "llm" ? "LLM" : "Rule-based"}
            </span>
            <span className="text-ink-faint">
              {new Date(displayReport.generated_at).toLocaleString()}
            </span>
            <button
              onClick={regenerate}
              disabled={streaming}
              title="Regenerate from LLM (bypasses cache)"
              className="ml-1 p-1.5 rounded-md text-ink-faint hover:text-accent hover:bg-bg-card disabled:opacity-50"
            >
              <RefreshCw size={12} className={streaming ? "animate-spin" : ""} />
            </button>
          </div>
        )}
      </div>

      {/* === Compact metrics bar ===
          Hidden entirely on mobile — the page already has the question
          input and the report below, and the dashboard itself has the same
          metrics in a friendlier layout. */}
      {metrics && (
        <div className="hidden sm:flex rounded-lg border border-line bg-bg-card px-3 py-2 items-center gap-4 overflow-x-auto text-sm">
          <Stat label="Net worth" value={fmtMoney(metrics.netWorth, "SGD")} />
          <Sep />
          <Stat label="Capital" value={fmtMoney(metrics.capital, "SGD")} />
          <Sep />
          <Stat label="Today" value={fmtMoney(metrics.dayChange, "SGD")} sub={fmtPct(metrics.dayChangePct, 2)} tone={metrics.dayChange >= 0 ? "good" : "bad"} />
          <Sep />
          <Stat label="TWR" value={fmtPct(metrics.twr, 2)} tone={metrics.twr >= 0 ? "good" : "bad"} />
          <Sep />
          <Stat label="XIRR" value={fmtPct(metrics.xirr, 2)} tone={metrics.xirr >= 0 ? "good" : "bad"} />
          <Sep />
          <Stat label="Positions" value={fmtNum(metrics.positions, 0)} />
        </div>
      )}

      {/* === Ask input === */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="relative rounded-xl border border-accent/30 bg-gradient-to-br from-bg-card to-accent/5 shadow-sm focus-within:border-accent focus-within:shadow-md transition-all"
      >
        <textarea
          ref={askRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything about your portfolio…  'Should I trim NVDA?' · 'How exposed am I to US tech?' · 'Is my dividend income sustainable?'"
          className="w-full bg-transparent px-4 sm:px-5 py-3.5 sm:py-4 pr-28 sm:pr-32 text-sm sm:text-base text-ink placeholder:text-ink-faint resize-none focus:outline-none"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(question);
            }
          }}
        />
        <div className="absolute right-2 sm:right-3 bottom-2 sm:bottom-3 flex items-center gap-1.5">
          {question && (
            <button
              type="button"
              onClick={() => setQuestion("")}
              className="p-1.5 rounded-md text-ink-faint hover:text-ink hover:bg-bg-soft"
              title="Clear"
            >
              <X size={14} />
            </button>
          )}
          <button
            type="submit"
            disabled={askBusy || !question.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent text-bg px-3 sm:px-4 py-1.5 sm:py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shadow-sm"
          >
            {askBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Ask
          </button>
        </div>
      </form>

      {streamError && (
        <div className="rounded-md border border-bad bg-bad/10 text-bad px-3 py-2 text-sm">
          {streamError}
        </div>
      )}

      {/* === Initial-load CTA === */}
      {loading && !displayReport && !streaming && (
        <div className="rounded-xl border border-line bg-bg-card p-8 text-center space-y-3">
          <Sparkles size={28} className="text-accent mx-auto" />
          <div>
            <div className="text-sm font-medium">No AI report yet</div>
            <div className="text-xs text-ink-dim mt-1">
              Click below to generate a fresh analysis. The AI's reasoning will stream in live.
            </div>
          </div>
          <button
            onClick={() => startStream(undefined).catch(() => {})}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent text-bg px-4 py-2 text-sm font-semibold hover:opacity-90 transition-opacity shadow-sm"
          >
            <Sparkles size={14} />
            Generate AI report
          </button>
        </div>
      )}

      {/* === Live streaming thinking block === */}
      {streaming && (
        <div className="rounded-xl border border-info/40 bg-info/5 overflow-hidden">
          <button
            onClick={() => setThinkingOpen((o) => !o)}
            className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-info/10 transition-colors"
          >
            <Brain size={14} className="text-info shrink-0" />
            <span className="text-sm font-semibold text-info">AI thinking</span>
            {streamingQuestion && (
              <span className="text-xs text-ink-dim italic truncate max-w-[40ch]">
                · {streamingQuestion}
              </span>
            )}
            <Loader2 size={12} className="animate-spin text-info shrink-0" />
            <span className="ml-auto text-xs text-ink-faint tabular-nums">
              {streamThinking.length} chars
            </span>
            {thinkingOpen ? <ChevronUp size={14} className="text-ink-faint" /> : <ChevronDown size={14} className="text-ink-faint" />}
          </button>
          {thinkingOpen && (
            <div
              ref={thinkingScrollRef}
              className="border-t border-info/20 px-4 py-3 text-sm text-ink-dim max-h-64 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed"
            >
              {streamThinking || <span className="italic text-ink-faint">…connecting to AI advisor…</span>}
            </div>
          )}
        </div>
      )}

      {displayReport && (
        <div className="space-y-3">
          {/* Risk flags + Opportunities side by side */}
          {(displayReport.risk_flags?.length > 0 || displayReport.opportunities?.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {displayReport.risk_flags?.length > 0 && (
                <div className="rounded-xl border border-bad/30 bg-bad/5 p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <AlertTriangle size={14} className="text-bad" />
                    <div className="text-sm font-semibold text-bad">Risk flags</div>
                    <span className="text-xs text-ink-faint ml-auto">{displayReport.risk_flags.length}</span>
                  </div>
                  <ul className="space-y-1.5">
                    {displayReport.risk_flags.map((f, i) => (
                      <li key={i} className="text-sm text-ink flex gap-2">
                        <span className="text-bad shrink-0 mt-0.5">•</span>
                        <span className="leading-snug">{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {displayReport.opportunities?.length > 0 && (
                <div className="rounded-xl border border-good/30 bg-good/5 p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Lightbulb size={14} className="text-good" />
                    <div className="text-sm font-semibold text-good">Opportunities</div>
                    <span className="text-xs text-ink-faint ml-auto">{displayReport.opportunities.length}</span>
                  </div>
                  <ul className="space-y-1.5">
                    {displayReport.opportunities.map((o, i) => (
                      <li key={i} className="text-sm text-ink flex gap-2">
                        <span className="text-good shrink-0 mt-0.5">•</span>
                        <span className="leading-snug">{o}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Full report */}
          <div className="rounded-xl border border-line bg-bg-card p-4 sm:p-5">
            <div className="text-xs uppercase tracking-[0.12em] text-ink-faint mb-3">Full report</div>
            <div className="prose prose-invert prose-sm max-w-none
              prose-headings:text-ink prose-headings:font-semibold
              prose-h1:text-lg prose-h2:text-base prose-h3:text-sm
              prose-p:text-ink prose-p:leading-relaxed
              prose-li:text-ink
              prose-strong:text-ink
              prose-table:text-sm
              prose-th:text-ink-faint prose-th:font-medium prose-th:uppercase prose-th:text-xs
              prose-td:tabular-nums
              prose-code:text-accent prose-code:bg-bg-soft prose-code:px-1 prose-code:rounded
            ">
              {displayReport.raw_markdown ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {stripOuterCodeFence(displayReport.raw_markdown)}
                </ReactMarkdown>
              ) : (
                <span className="italic text-ink-faint">…waiting for content…</span>
              )}
              {streaming && <span className="inline-block w-1.5 h-4 bg-accent ml-0.5 animate-pulse align-middle" />}
            </div>
          </div>

          <p className="text-xs text-ink-faint text-center px-4">
            Educational analysis only. Not personalised financial advice. Past performance does not guarantee future results.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  const color = tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : "text-ink";
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-xs uppercase tracking-[0.12em] text-ink-faint">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${color}`}>{value}</span>
      {sub && <span className={`text-xs tabular-nums ${color}`}>· {sub}</span>}
    </div>
  );
}

function Sep() {
  return <span className="w-px h-4 bg-line" />;
}
import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Sparkles, AlertTriangle, Lightbulb, Send, Loader2, X, RefreshCw, Brain, ChevronDown, ChevronUp } from "lucide-react";
import { fmtMoney, fmtPct, fmtNum } from "../lib/utils";
import { useDashboard } from "../hooks/usePortfolio";

interface AdviceReport {
  generated_at: string;
  summary: string;
  sections: { title: string; items: string[] }[];
  risk_flags: string[];
  opportunities: string[];
  raw_markdown: string;
  source: "rule-based" | "llm";
  question?: string; // populated when the report was a custom-question answer
}

const ADVICE_KEY = ["advice", "full"] as const;
const ADVICE_LS_KEY = "equity-ark-advice-cache-v1";

function readPersistedReport(): AdviceReport | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(ADVICE_LS_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as AdviceReport;
    // Only restore if it's recent enough (24 h) — old reports are stale.
    if (!parsed.generated_at) return undefined;
    const age = Date.now() - new Date(parsed.generated_at).getTime();
    if (age > 24 * 60 * 60 * 1000) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function writePersistedReport(r: AdviceReport) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ADVICE_LS_KEY, JSON.stringify(r));
  } catch {
    /* quota exceeded etc. — ignore */
  }
}


export default function Advice() {
  const [question, setQuestion] = useState("");
  const [askBusy, setAskBusy] = useState(false);
  const [error, setError] = useState<string>("");
  // Live streaming state — overlays the cached report as the LLM generates.
  const [streaming, setStreaming] = useState(false);
  const [streamThinking, setStreamThinking] = useState("");
  const [streamContent, setStreamContent] = useState("");
  const [streamSource, setStreamSource] = useState<"llm" | "rule-based" | null>(null);
  const [thinkingOpen, setThinkingOpen] = useState(true);
  const askRef = useRef<HTMLTextAreaElement>(null);
  const thinkingScrollRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  // The current question (empty = the default "full review" report).
  const [activeQuestion, setActiveQuestion] = useState<string>("");
  // Question being streamed right now (used to label the AI thinking panel).
  const [streamingQuestion, setStreamingQuestion] = useState<string | null>(null);

  const {
    data: report,
    isLoading: loading,
  } = useQuery<AdviceReport>({
    queryKey: ADVICE_KEY,
    queryFn: () => api.advice("full", undefined, false) as Promise<AdviceReport>,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
    // Seed from localStorage so the user sees the last cached report
    // immediately on page load — no spinner if we have anything fresh.
    initialData: readPersistedReport,
  });

  // The answer to the active question (if any). Persisted to localStorage
  // so navigating away and back keeps the user's last answer.
  const [questionAnswer, setQuestionAnswer] = useState<AdviceReport | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(ADVICE_LS_KEY + ":q");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AdviceReport;
      const age = Date.now() - new Date(parsed.generated_at).getTime();
      return age < 24 * 60 * 60 * 1000 ? parsed : null;
    } catch { return null; }
  });
  const [activeQuestionText, setActiveQuestionText] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try { return localStorage.getItem(ADVICE_LS_KEY + ":qt") || ""; } catch { return ""; }
  });

  // Persist to localStorage whenever the report changes.
  useEffect(() => {
    if (report && !report.question) writePersistedReport(report);
  }, [report]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (questionAnswer) localStorage.setItem(ADVICE_LS_KEY + ":q", JSON.stringify(questionAnswer));
      else localStorage.removeItem(ADVICE_LS_KEY + ":q");
    } catch {}
  }, [questionAnswer]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (activeQuestionText) localStorage.setItem(ADVICE_LS_KEY + ":qt", activeQuestionText);
      else localStorage.removeItem(ADVICE_LS_KEY + ":qt");
    } catch {}
  }, [activeQuestionText]);

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
  // streaming flow so the user sees the "AI thinking" panel immediately
  // instead of a generic spinner.
  useEffect(() => {
    if (report) return;
    const cached = qc.getQueryData<AdviceReport>(ADVICE_KEY);
    if (cached) return;
    const t = setTimeout(() => {
      if (!report && !streaming && !askBusy) {
        setStreamThinking("");
        setStreamContent("");
        setStreamSource(null);
        setStreaming(true);
        setThinkingOpen(true);
        streamAdvice(undefined).catch((e) => {
          setError(e?.message || "Failed to start stream");
          setStreaming(false);
        });
      }
    }, 400); // tiny grace period — React Query might have it in 200ms
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Manual regenerate — streams the response so the user can watch the LLM think.
  async function regenerate() {
    setError("");
    setStreamThinking("");
    setStreamContent("");
    setStreamSource(null);
    setStreamingQuestion(null);
    // Clearing the question makes the display fall back to the default report.
    setActiveQuestion("");
    setQuestionAnswer(null);
    setStreaming(true);
    setThinkingOpen(true);
    try {
      await streamAdvice(undefined);
    } catch (e: any) {
      setError(e.message || "Failed to generate report");
      setStreaming(false);
    }
  }

  // Ask a custom question — separate cache slot, so the "default" report is preserved.
  async function ask(q: string) {
    if (!q.trim()) return;
    setAskBusy(true);
    setError("");
    setStreamThinking("");
    setStreamContent("");
    setStreamSource(null);
    setStreamingQuestion(q);
    setActiveQuestion(q);
    setStreaming(true);
    setThinkingOpen(true);
    try {
      await streamAdvice(q);
    } catch (e: any) {
      setError(e.message || "Failed to ask question");
    } finally {
      setAskBusy(false);
    }
  }

  // Clear the active question and revert to the default report view.
  function clearQuestion() {
    setActiveQuestion("");
    setQuestionAnswer(null);
    setActiveQuestionText("");
    setError("");
  }

  // Streams the LLM response. Updates the UI incrementally, then commits
  // the final report to the React Query cache. Uses an AbortController
  // so navigating away cancels the in-flight request.
  const streamAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => { streamAbortRef.current?.abort(); };
  }, []);

  // Throttle state updates so 6500+ rapid reasoning deltas don't kill React.
  // The accumulator ref holds the live text; the state is flushed at most
  // every ~80ms (or every ~2 KB), whichever comes first.
  const thinkingBufRef = useRef({ text: "", dirty: false, lastFlush: 0 });
  const contentBufRef = useRef({ text: "", dirty: false, lastFlush: 0 });

  // Continuously run while `streaming` is true. Important: keep the loop
  // alive even when there's no dirty data, so new events arriving between
  // frames still get flushed. (The previous version stopped the loop on the
  // first idle frame, which meant anything flushed *after* that never made
  // it to the DOM.)
  useEffect(() => {
    if (!streaming) return;
    let raf: number | null = null;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const now = performance.now();
      if (thinkingBufRef.current.dirty && now - thinkingBufRef.current.lastFlush > 80) {
        setStreamThinking(thinkingBufRef.current.text);
        thinkingBufRef.current.dirty = false;
        thinkingBufRef.current.lastFlush = now;
      }
      if (contentBufRef.current.dirty && now - contentBufRef.current.lastFlush > 80) {
        setStreamContent(contentBufRef.current.text);
        contentBufRef.current.dirty = false;
        contentBufRef.current.lastFlush = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [streaming]);

  // Auto-scroll the thinking panel to the bottom as content streams in.
  // Uses a "user scrolled up" detector so we don't fight the user when
  // they scroll back to read earlier text.
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
  }, [streamThinking, thinkingOpen, streaming]);

  async function streamAdvice(customQ?: string) {
    streamAbortRef.current?.abort();
    const ctrl = new AbortController();
    streamAbortRef.current = ctrl;

    // Reset buffers
    thinkingBufRef.current = { text: "", dirty: false, lastFlush: 0 };
    contentBufRef.current = { text: "", dirty: false, lastFlush: 0 };

    const res = await fetch("/api/portfolio/advice/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ focus: "full", custom_question: customQ, refresh: true }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`stream ${res.status}: ${await res.text()}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let finalReport: AdviceReport | null = null;
    let fallbackError: string | null = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE: events are separated by blank lines.
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev = parseSse(block);
        if (!ev) continue;
        if (ev.event === "thinking") {
          const chunk = ev.data.content || "";
          thinkingBufRef.current.text += chunk;
          thinkingBufRef.current.dirty = true;
        } else if (ev.event === "content") {
          const chunk = ev.data.content || "";
          contentBufRef.current.text += chunk;
          contentBufRef.current.dirty = true;
        } else if (ev.event === "report") {
          finalReport = ev.data.report;
          if (ev.data.thinking) {
            thinkingBufRef.current.text += ev.data.thinking;
            thinkingBufRef.current.dirty = true;
          }
          if (ev.data.error) {
            fallbackError = ev.data.error;
          }
        } else if (ev.event === "error") {
          throw new Error(ev.data.message || "stream error");
        }
      }
    }
    // Final flush — guarantees the final chunks are visible.
    if (thinkingBufRef.current.dirty) setStreamThinking(thinkingBufRef.current.text);
    if (contentBufRef.current.dirty) setStreamContent(contentBufRef.current.text);

    if (finalReport) {
      const tagged = customQ ? { ...finalReport, question: customQ } : finalReport;
      setStreamSource(tagged.source);
      if (customQ) {
        // Question answer — keep in its own slot, persisted to localStorage.
        setQuestionAnswer(tagged);
        setActiveQuestionText(customQ);
        setActiveQuestion(customQ);
      } else {
        // Default report — update the React Query cache + localStorage.
        qc.setQueryData(ADVICE_KEY, tagged);
      }
      if (fallbackError) {
        setError("AI advisor is temporarily unavailable — showing the last AI report.");
      }
    }
    setStreaming(false);
  }

  // Clean up the streaming overlay when the cached report is loaded.
  useEffect(() => {
    if (!streaming) {
      setStreamThinking("");
      setStreamContent("");
      setStreamSource(null);
    }
  }, [streaming]);

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
          </h1>
          <p className="text-ink-dim text-sm mt-0.5">
            Grounded analysis from your live holdings, transactions, and dividend cash flows.
          </p>
        </div>
        {displayReport && (
          <div className="flex items-center gap-2 text-xs flex-wrap">
            {activeQuestion && !streaming && (
              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-info/10 text-info">
                <Brain size={11} />
                <span className="max-w-[40ch] truncate">Q: {activeQuestion}</span>
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

      {/* === Compact metrics bar === */}
      {metrics && (
        <div className="rounded-lg border border-line bg-bg-card px-3 py-2 flex items-center gap-4 overflow-x-auto text-sm">
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

      {error && (
        <div className="rounded-md border border-bad bg-bad/10 text-bad px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {/* === Initial-load: show a "Generate" CTA when nothing's loaded yet.
              The streaming panel below handles the in-progress state. === */}
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
            onClick={() => {
              setStreamThinking("");
              setStreamContent("");
              setStreamSource(null);
              setStreaming(true);
              setThinkingOpen(true);
              streamAdvice(undefined).catch((e) => {
                setError(e?.message || "Failed to generate");
                setStreaming(false);
              });
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent text-bg px-4 py-2 text-sm font-semibold hover:opacity-90 transition-opacity shadow-sm"
          >
            <Sparkles size={14} />
            Generate AI report
          </button>
        </div>
      )}

      {/* === Live streaming thinking block — shows as soon as streaming starts === */}
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
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayReport.raw_markdown}</ReactMarkdown>
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

function parseSse(block: string): { event: string; data: any } | null {
  let event = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).trim();
  }
  if (!data) return null;
  try { return { event, data: JSON.parse(data) }; } catch { return null; }
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

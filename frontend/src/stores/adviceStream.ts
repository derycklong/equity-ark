// Module-level singleton that owns the in-flight advice stream.
// The Advice page subscribes via the `useAdviceStream` hook; the actual SSE
// connection lives outside the React tree so navigating away from /advice
// does NOT cancel the stream — the LLM keeps generating and the user can
// return to see the finished report.

import { create } from "zustand";

export interface AdviceReport {
  generated_at: string;
  summary: string;
  sections: { title: string; items: string[] }[];
  risk_flags: string[];
  opportunities: string[];
  raw_markdown: string;
  source: "rule-based" | "llm";
  question?: string;
}

export interface AdviceStreamState {
  streaming: boolean;
  thinking: string;
  content: string;
  source: "llm" | "rule-based" | null;
  question: string | null;
  error: string | null;
  lastReport: AdviceReport | null;
  startedAt: number | null;
  finishedAt: number | null;
  // Forces the Advice page to consume the latest streaming values, even if
  // it mounted mid-stream. Bumped on every chunk.
  version: number;
}

interface InternalBuffers {
  thinkingText: string;
  contentText: string;
  thinkingDirty: boolean;
  contentDirty: boolean;
  lastFlush: number;
}

const FLUSH_INTERVAL_MS = 80;

const initialState: AdviceStreamState = {
  streaming: false,
  thinking: "",
  content: "",
  source: null,
  question: null,
  error: null,
  lastReport: null,
  startedAt: null,
  finishedAt: null,
  version: 0,
};

interface AdviceStreamStore extends AdviceStreamState {
  // Imperative actions used by Advice.tsx
  start: (customQuestion?: string) => Promise<void>;
  stop: () => void;
  clearError: () => void;
  setQuestionAnswer: (r: AdviceReport | null) => void;
  setActiveQuestion: (q: string) => void;
}

export const useAdviceStreamStore = create<AdviceStreamStore>((set, get) => {
  let abortController: AbortController | null = null;
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  const buf: InternalBuffers = {
    thinkingText: "",
    contentText: "",
    thinkingDirty: false,
    contentDirty: false,
    lastFlush: 0,
  };
  // Promise that resolves when the active stream finishes (success or error).
  let activeStreamPromise: Promise<void> | null = null;

  function flushBuffers() {
    const now = Date.now();
    if (buf.thinkingDirty && now - buf.lastFlush >= FLUSH_INTERVAL_MS) {
      buf.thinkingDirty = false;
      buf.contentDirty = false;
      buf.lastFlush = now;
      set((s) => ({
        thinking: buf.thinkingText,
        content: buf.contentText,
        version: s.version + 1,
      }));
    } else if (buf.contentDirty && now - buf.lastFlush >= FLUSH_INTERVAL_MS) {
      buf.contentDirty = false;
      buf.lastFlush = now;
      set((s) => ({ content: buf.contentText, version: s.version + 1 }));
    }
  }

  function ensureFlushTimer() {
    if (flushTimer) return;
    flushTimer = setInterval(() => {
      if (!get().streaming) {
        if (flushTimer) {
          clearInterval(flushTimer);
          flushTimer = null;
        }
        return;
      }
      flushBuffers();
    }, FLUSH_INTERVAL_MS);
  }

  async function runStream(customQuestion?: string): Promise<void> {
    // Reset
    buf.thinkingText = "";
    buf.contentText = "";
    buf.thinkingDirty = false;
    buf.contentDirty = false;
    buf.lastFlush = 0;
    set({
      streaming: true,
      thinking: "",
      content: "",
      source: null,
      question: customQuestion ?? null,
      error: null,
      startedAt: Date.now(),
      finishedAt: null,
      version: 0,
    });
    ensureFlushTimer();

    abortController?.abort();
    const ctrl = new AbortController();
    abortController = ctrl;

    try {
      const res = await fetch("/api/portfolio/advice/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ focus: "full", custom_question: customQuestion, refresh: true }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`stream ${res.status}: ${await res.text()}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let bufSse = "";
      let finalReport: AdviceReport | null = null;
      let fallbackError: string | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bufSse += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = bufSse.indexOf("\n\n")) !== -1) {
          const block = bufSse.slice(0, idx);
          bufSse = bufSse.slice(idx + 2);
          const ev = parseSse(block);
          if (!ev) continue;
          if (ev.event === "thinking") {
            const chunk = ev.data.content || "";
            buf.thinkingText += chunk;
            buf.thinkingDirty = true;
          } else if (ev.event === "content") {
            const chunk = ev.data.content || "";
            buf.contentText += chunk;
            buf.contentDirty = true;
          } else if (ev.event === "report") {
            finalReport = ev.data.report;
            if (ev.data.thinking) {
              buf.thinkingText += ev.data.thinking;
              buf.thinkingDirty = true;
            }
            if (ev.data.error) {
              fallbackError = ev.data.error;
            }
          } else if (ev.event === "error") {
            throw new Error(ev.data.message || "stream error");
          }
        }
      }

      // Final flush
      flushBuffers();

      if (finalReport) {
        const tagged = customQuestion ? { ...finalReport, question: customQuestion } : finalReport;
        set({
          source: tagged.source,
          lastReport: tagged,
          finishedAt: Date.now(),
        });
        if (fallbackError) {
          set({ error: "AI advisor is temporarily unavailable — showing the last AI report." });
        }
      } else {
        set({ finishedAt: Date.now() });
      }
    } catch (e: any) {
      if (e?.name === "AbortError") {
        // Silent — user navigated away then came back, or pressed Stop.
        set({ finishedAt: Date.now() });
      } else {
        set({ error: e?.message || "Stream failed", finishedAt: Date.now() });
      }
    } finally {
      set({ streaming: false });
      if (abortController === ctrl) abortController = null;
      activeStreamPromise = null;
    }
  }

  return {
    ...initialState,

    start: (customQuestion?: string) => {
      if (activeStreamPromise) return activeStreamPromise;
      activeStreamPromise = runStream(customQuestion);
      return activeStreamPromise;
    },

    stop: () => {
      abortController?.abort();
    },

    clearError: () => set({ error: null }),

    setQuestionAnswer: (r) => set({ lastReport: r }),

    setActiveQuestion: (q) => set({ question: q }),
  };
});

// Convenience hook — re-renders the component on every store change.
// Used by Advice.tsx and the sidebar nav indicator.
export function useAdviceStream() {
  return useAdviceStreamStore((s) => ({
    streaming: s.streaming,
    thinking: s.thinking,
    content: s.content,
    source: s.source,
    question: s.question,
    error: s.error,
    lastReport: s.lastReport,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    version: s.version,
  }));
}

function parseSse(block: string): { event: string; data: any } | null {
  let event = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).trim();
  }
  if (!data) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return null;
  }
}
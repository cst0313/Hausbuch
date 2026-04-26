// path: src/components/CmdK.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Glyph, Btn } from "./DashboardPrimitives";

type SearchItem = {
  kind: string;
  glyph: string;
  id: string;
  name: string;
  sub: string;
  tag?: string;
  tagSev?: "critical" | "high" | "medium" | "ok";
};

type SearchGroup = { title: string; items: SearchItem[] };

type AgentStep = { type: string; content: string; ts: string };
/** localStorage key for the recent-question history (last 10, deduped). */
const RECENT_KEY = "hausbuch.cmdk.recent";

type AgentResponse = {
  answer: string;
  citations: string[];
  steps: AgentStep[];
  suggestions: Array<{ type: string; label: string; detail?: string }>;
  facts_used: number;
  model: string;
  latency_ms: number;
  entities_accessed?: string[];
  transcription?: { text: string; latency_ms: number; model: string };
};

export function CmdK({
  open,
  onClose,
  onOpenEntity,
}: {
  open: boolean;
  onClose: () => void;
  onOpenEntity?: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [searching, setSearching] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentResp, setAgentResp] = useState<AgentResponse | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [feedbackNote, setFeedbackNote] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Web Audio capture state — Gradium needs raw PCM (s16le mono 24kHz),
  // not the MediaRecorder webm/opus the browser hands you by default.
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);

  // Reset on open + load recent queries from localStorage
  useEffect(() => {
    if (open) {
      setQuery("");
      setGroups([]);
      setAgentMode(false);
      setAgentResp(null);
      setFeedback(null);
      setFeedbackNote(null);
      try {
        const raw = window.localStorage.getItem(RECENT_KEY);
        const list = raw ? (JSON.parse(raw) as unknown) : [];
        if (Array.isArray(list)) {
          setRecent(list.filter((x): x is string => typeof x === "string").slice(0, 10));
        }
      } catch {
        /* localStorage unavailable */
      }
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  /** Push the latest query to the front of the recent list, dedup, cap at 10. */
  const rememberQuery = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setRecent((prev) => {
      const next = [trimmed, ...prev.filter((x) => x !== trimmed)].slice(0, 10);
      try {
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota/disabled */
      }
      return next;
    });
  };

  // Reset feedback whenever a fresh answer arrives
  useEffect(() => {
    if (agentLoading) {
      setFeedback(null);
      setFeedbackNote(null);
    }
  }, [agentLoading]);

  const sendFeedback = async (rating: "up" | "down") => {
    if (!agentResp) return;
    setFeedback(rating);
    setFeedbackNote(rating === "up" ? "thanks — noted" : "thanks — we'll learn");
    // Fire and forget: the user doesn't need to know which priors moved.
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: query,
        answer: agentResp.answer,
        model: agentResp.model,
        facts_used: agentResp.facts_used,
        citations: agentResp.citations,
        entities_accessed: agentResp.entities_accessed ?? [],
        rating,
      }),
    }).catch(() => {
      /* swallow — the audit log will note the network error if any */
    });
  };

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Debounced search
  useEffect(() => {
    if (!open || agentMode) return;
    const q = query.trim();
    if (!q) {
      setGroups([]);
      return;
    }
    setSearching(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => setGroups(d.groups ?? []))
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, open, agentMode]);

  const askAgent = () => {
    const q = query.trim();
    if (!q) return;
    rememberQuery(q);
    setAgentMode(true);
    setAgentLoading(true);
    setAgentResp(null);
    fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: q }),
    })
      .then((r) => r.json())
      .then((raw: Partial<AgentResponse> & { error?: string }) => {
        setAgentResp({
          answer: raw.answer ?? raw.error ?? "No answer.",
          citations: raw.citations ?? [],
          steps: raw.steps ?? [],
          suggestions: raw.suggestions ?? [],
          facts_used: raw.facts_used ?? 0,
          model: raw.model ?? "—",
          latency_ms: raw.latency_ms ?? 0,
          entities_accessed: raw.entities_accessed ?? [],
          transcription: raw.transcription,
        });
      })
      .catch((err) => {
        setAgentResp({
          answer: `Agent request failed: ${err instanceof Error ? err.message : String(err)}`,
          citations: [],
          steps: [],
          suggestions: [],
          facts_used: 0,
          model: "—",
          latency_ms: 0,
        });
      })
      .finally(() => setAgentLoading(false));
  };

  // Voice → Gradium ASR (WebSocket, server-side) → /api/agent
  // The browser captures raw PCM at the device sample rate; we resample to
  // 24 kHz mono signed 16-bit and post as application/octet-stream so the
  // server can forward straight to Gradium.
  const startRecording = async () => {
    try {
      // Ask for mono audio with the browser's processing OFF — anything fancy
      // can resample our buffer behind the scenes and confuse the duration math.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      // Try to lock the AudioContext at 24 kHz so the resample step is a no-op.
      // Browsers that don't honor the option fall back to their default and
      // we resample below.
      let ctx: AudioContext;
      try {
        ctx = new Ctor({ sampleRate: 24_000 });
      } catch {
        ctx = new Ctor();
      }
      audioCtxRef.current = ctx;
      const sourceNode = ctx.createMediaStreamSource(stream);
      sourceNodeRef.current = sourceNode;
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      pcmChunksRef.current = [];
      processor.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0);
        pcmChunksRef.current.push(new Float32Array(ch));
      };
      sourceNode.connect(processor);
      // Route the processor through a muted gain node so it keeps firing in
      // browsers that require a destination connection — but the user does
      // NOT hear themselves played back through the speakers (the source of
      // the perceived "5x slow" echo).
      const mute = ctx.createGain();
      mute.gain.value = 0;
      processor.connect(mute);
      mute.connect(ctx.destination);
      setRecording(true);
    } catch (err) {
      console.warn("[cmdk] mic permission denied or unavailable", err);
      setRecording(false);
    }
  };

  const stopRecording = async () => {
    setRecording(false);
    const ctx = audioCtxRef.current;
    const processor = processorRef.current;
    const sourceNode = sourceNodeRef.current;
    const stream = streamRef.current;

    try {
      processor?.disconnect();
      sourceNode?.disconnect();
    } catch {
      /* ignore */
    }

    const chunks = pcmChunksRef.current;
    pcmChunksRef.current = [];

    if (!ctx || chunks.length === 0) {
      stream?.getTracks().forEach((t) => t.stop());
      return;
    }

    // Concatenate all captured Float32 frames at the AudioContext's native rate.
    const totalSamples = chunks.reduce((n, c) => n + c.length, 0);
    const captured = new Float32Array(totalSamples);
    let offset = 0;
    for (const c of chunks) {
      captured.set(c, offset);
      offset += c.length;
    }

    // Resample to 24 kHz (Gradium target) using the OfflineAudioContext.
    const targetRate = 24_000;
    let resampled: Float32Array = captured;
    if (Math.round(ctx.sampleRate) !== targetRate) {
      try {
        const offline = new OfflineAudioContext(
          1,
          Math.ceil((captured.length / ctx.sampleRate) * targetRate),
          targetRate,
        );
        const buffer = offline.createBuffer(1, captured.length, ctx.sampleRate);
        buffer.copyToChannel(captured, 0);
        const src = offline.createBufferSource();
        src.buffer = buffer;
        src.connect(offline.destination);
        src.start();
        const rendered = await offline.startRendering();
        resampled = rendered.getChannelData(0);
      } catch (err) {
        console.warn("[cmdk] resample failed, sending native rate", err);
      }
    }

    // Float32 [-1, 1] → s16le PCM
    const pcm = new Int16Array(resampled.length);
    for (let i = 0; i < resampled.length; i++) {
      const s = Math.max(-1, Math.min(1, resampled[i]));
      pcm[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    }

    stream?.getTracks().forEach((t) => t.stop());
    try {
      await ctx.close();
    } catch {
      /* ignore */
    }

    if (pcm.length < 4_800) {
      // < 200ms — too short, abort
      return;
    }

    setTranscribing(true);
    setAgentMode(true);
    setAgentLoading(true);
    setAgentResp(null);

    try {
      const r = await fetch("/api/agent/voice", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: pcm.buffer,
      });
      const raw = (await r.json()) as Partial<AgentResponse> & { error?: string };
      const safe: AgentResponse = {
        answer: raw.answer ?? raw.error ?? "No answer.",
        citations: raw.citations ?? [],
        steps: raw.steps ?? [],
        suggestions: raw.suggestions ?? [],
        facts_used: raw.facts_used ?? 0,
        model: raw.model ?? "—",
        latency_ms: raw.latency_ms ?? 0,
        entities_accessed: raw.entities_accessed ?? [],
        transcription: raw.transcription,
      };
      setAgentResp(safe);
      if (safe.transcription?.text) setQuery(safe.transcription.text);
    } catch (err) {
      setAgentResp({
        answer: `Voice request failed: ${err instanceof Error ? err.message : String(err)}`,
        citations: [],
        steps: [],
        suggestions: [],
        facts_used: 0,
        model: "—",
        latency_ms: 0,
      });
    } finally {
      setTranscribing(false);
      setAgentLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && query.trim() && !agentMode) {
      e.preventDefault();
      askAgent();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (agentMode) {
        setAgentMode(false);
        setAgentResp(null);
      } else {
        onClose();
      }
    }
  };

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(28,25,23,0.32)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "8vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 720,
          maxWidth: "92%",
          background: "var(--bg)",
          borderRadius: 10,
          border: "1px solid var(--border-muted)",
          boxShadow: "0 24px 80px rgba(28,25,23,0.20)",
          overflow: "hidden",
        }}
      >
        {/* Input */}
        <div
          style={{
            padding: "16px 18px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            borderBottom:
              groups.length > 0 || agentMode || query ? "1px solid var(--border)" : "none",
          }}
        >
          <span
            style={{ color: "var(--brand)", fontFamily: "var(--font-mono)", fontSize: 16 }}
          >
            ✦
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (agentMode) {
                setAgentMode(false);
                setAgentResp(null);
              }
            }}
            onKeyDown={onKeyDown}
            placeholder="Ask anything, or jump to a tenant, owner, contractor, building…"
            style={{
              flex: 1,
              fontSize: 17,
              letterSpacing: "-0.015em",
              fontWeight: 400,
              color: "var(--fg)",
              border: "none",
              outline: "none",
              background: "transparent",
              fontFamily: "var(--font-sans)",
            }}
          />
          <button
            onClick={recording ? stopRecording : startRecording}
            aria-label={recording ? "Stop recording" : "Speak instead"}
            title={recording ? "Stop recording" : "Speak instead (Gradium)"}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "1px solid " + (recording ? "var(--brand)" : "var(--border)"),
              background: recording ? "var(--brand-wash)" : "transparent",
              color: recording ? "var(--brand)" : "var(--fg-muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
            className={recording ? "pulse" : ""}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="6" y="2.5" width="4" height="7" rx="2" stroke="currentColor" strokeWidth="1.4" />
              <path d="M3.5 8a4.5 4.5 0 009 0M8 12.5v1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
          <span className="kbd">esc</span>
        </div>

        {/* Empty state */}
        {!query && !agentMode && (
          <div style={{ padding: "14px 18px 18px" }}>
            {recent.length > 0 && (
              <>
                <div
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: "var(--fg-dim)",
                    textTransform: "uppercase",
                    letterSpacing: 0.04,
                    marginBottom: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span>Recent questions</span>
                  <button
                    onClick={() => {
                      setRecent([]);
                      try {
                        window.localStorage.removeItem(RECENT_KEY);
                      } catch {
                        /* ignore */
                      }
                    }}
                    style={{
                      fontSize: 9,
                      color: "var(--fg-dim)",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      padding: 0,
                    }}
                  >
                    clear
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 14 }}>
                  {recent.slice(0, 3).map((q, i) => (
                    <button
                      key={`${q}-${i}`}
                      onClick={() => {
                        setQuery(q);
                        // Re-run immediately — saves the user a keystroke.
                        setTimeout(() => askAgent(), 30);
                      }}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "20px 1fr auto",
                        gap: 12,
                        padding: "8px 10px",
                        alignItems: "center",
                        background: "transparent",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        textAlign: "left",
                        color: "var(--fg)",
                        fontFamily: "inherit",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "var(--bg-hover)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                      }
                      title="Ask the agent again"
                    >
                      <span
                        className="mono"
                        style={{ color: "var(--fg-dim)", fontSize: 11 }}
                      >
                        ↻
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          color: "var(--fg)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {q}
                      </span>
                      <span
                        className="mono"
                        style={{ fontSize: 10, color: "var(--fg-dim)" }}
                      >
                        re-ask ↵
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {/*
              Curated guiding questions. Every entry is a query the agent
              answers reliably and quickly on the seeded corpus — single-
              entity lookups, status checks, and small aggregations that
              match facts already in the store. Avoids open-ended
              cross-entity aggregations the agent can't yet answer well.
            */}
            <div
              className="mono"
              style={{
                fontSize: 10,
                color: "var(--fg-dim)",
                textTransform: "uppercase",
                letterSpacing: 0.04,
                marginBottom: 10,
              }}
            >
              Try asking
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 6,
                marginBottom: 14,
              }}
            >
              {[
                "How much rent does Edeltraud Renner pay?",
                "Who lives in unit 32?",
                "What are Magrit Mitschke's open issues?",
                "Has the water damage in unit 29 been resolved?",
                "When does Ferenc Stahr's lease end?",
                "Who is the owner of unit 23?",
                "What's the most recent dunning notice?",
                "Show all critical cases right now.",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setQuery(q);
                    setTimeout(() => askAgent(), 30);
                  }}
                  style={{
                    padding: "8px 10px",
                    border: "1px solid var(--border-muted)",
                    borderRadius: 6,
                    background: "var(--bg)",
                    color: "var(--fg-muted)",
                    fontSize: 12,
                    textAlign: "left",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    lineHeight: 1.4,
                    transition: "background 120ms, border-color 120ms",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.borderColor = "var(--brand)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "var(--bg)";
                    e.currentTarget.style.borderColor = "var(--border-muted)";
                  }}
                  title="Ask the agent"
                >
                  {q}
                </button>
              ))}
            </div>
            <div
              className="mono"
              style={{
                fontSize: 10,
                color: "var(--fg-dim)",
                textTransform: "uppercase",
                letterSpacing: 0.04,
                marginBottom: 10,
              }}
            >
              Tips
            </div>
            <div
              className="mono"
              style={{ fontSize: 11, color: "var(--fg-muted)", lineHeight: 1.7 }}
            >
              <div>
                <span className="kbd">↑↓</span> navigate · <span className="kbd">↵</span> ask
                the agent · <span className="kbd">esc</span> close
              </div>
              <div style={{ marginTop: 6 }}>
                Type a tenant name, unit number, email subject, or any question.
              </div>
            </div>
          </div>
        )}

        {/* Search results */}
        {query && !agentMode && (
          <div style={{ maxHeight: "60vh", overflow: "auto" }}>
            {/* Always-first agent row */}
            <div style={{ padding: "10px 18px 4px" }}>
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  color: "var(--brand)",
                  textTransform: "uppercase",
                  letterSpacing: 0.04,
                  marginBottom: 6,
                }}
              >
                Ask the agent
              </div>
              <PaletteRow
                glyph="agent"
                name={`Ask: ${query}`}
                sub="gemini · cites entities + facts"
                tag="↵ to ask"
                tagSev="ok"
                highlighted
                onSelect={askAgent}
              />
            </div>

            {searching && groups.length === 0 && (
              <div
                style={{ padding: "14px 18px", fontSize: 11, color: "var(--fg-dim)" }}
              >
                Searching…
              </div>
            )}

            {groups.map((g) => (
              <div
                key={g.title}
                style={{ padding: "10px 18px 4px", borderTop: "1px solid var(--border)" }}
              >
                <div
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: "var(--fg-dim)",
                    textTransform: "uppercase",
                    letterSpacing: 0.04,
                    marginBottom: 6,
                  }}
                >
                  {g.title}
                </div>
                {g.items.map((it) => {
                  const openable =
                    onOpenEntity &&
                    /^(tenant|owner|unit|building|weg|contractor):/.test(it.id);
                  return (
                    <PaletteRow
                      key={`${g.title}-${it.id}`}
                      {...it}
                      onSelect={openable ? () => onOpenEntity!(it.id) : undefined}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* Agent answer */}
        {agentMode && (
          <div style={{ padding: "14px 18px 18px", maxHeight: "70vh", overflow: "auto" }}>
            <div
              className="mono"
              style={{
                fontSize: 10,
                color: "var(--brand)",
                textTransform: "uppercase",
                letterSpacing: 0.04,
                marginBottom: 10,
              }}
            >
              Reasoning {agentResp ? `· ${agentResp.model}` : ""}
            </div>

            {transcribing && (
              <div className="mono pulse" style={{ fontSize: 11, color: "var(--brand)", marginBottom: 8 }}>
                ▸▸▸ transcribing via Gradium…
              </div>
            )}

            {agentResp?.transcription && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "8px 10px",
                  background: "var(--brand-wash)",
                  borderRadius: 6,
                  border: "1px solid var(--brand-line)",
                  fontSize: 12,
                }}
              >
                <span className="mono" style={{ color: "var(--brand)", fontSize: 10 }}>
                  heard you ·
                </span>{" "}
                <span style={{ color: "var(--fg)" }}>"{agentResp.transcription.text}"</span>
                <span className="mono" style={{ color: "var(--fg-dim)", fontSize: 10, marginLeft: 8 }}>
                  · {agentResp.transcription.model} · {agentResp.transcription.latency_ms}ms
                </span>
              </div>
            )}

            {agentLoading && !agentResp && !transcribing && (
              <div
                className="mono pulse"
                style={{ fontSize: 11, color: "var(--fg-dim)" }}
              >
                ▸▸▸ contacting agent…
              </div>
            )}

            {agentResp && (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                  {(agentResp.steps ?? []).map((s, i) => (
                    <div
                      key={i}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "70px 80px 1fr",
                        gap: 10,
                        fontSize: 11,
                        alignItems: "baseline",
                      }}
                    >
                      <span className="mono" style={{ color: "var(--fg-dim)" }}>
                        {s.ts.slice(11, 19)}
                      </span>
                      <span
                        className="mono"
                        style={{ color: "var(--brand)", fontWeight: 500 }}
                      >
                        {s.type}
                      </span>
                      <span style={{ color: "var(--fg-muted)" }}>{s.content}</span>
                    </div>
                  ))}
                </div>

                <div
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: "var(--fg-dim)",
                    textTransform: "uppercase",
                    letterSpacing: 0.04,
                    marginBottom: 8,
                  }}
                >
                  Answer
                </div>
                <div
                  style={{
                    fontSize: 13.5,
                    lineHeight: 1.6,
                    color: "var(--fg)",
                    padding: "14px 16px",
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    whiteSpace: "pre-wrap",
                  }}
                  dangerouslySetInnerHTML={{
                    __html: agentResp.answer
                      .replace(/&/g, "&amp;")
                      .replace(/</g, "&lt;")
                      .replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight: 600;">$1</strong>')
                      .replace(
                        /\*(.+?)\*/g,
                        '<em style="font-family: var(--font-serif); font-style: italic; color: var(--fg-muted);">$1</em>',
                      ),
                  }}
                />

                {/* Citations + entity navigation. The agent emits citation
                    labels like "Schimmel-Meldung" via ^[X] markers in the
                    answer. We can't always resolve those to a specific source
                    id, but we DO know every entity the agent inspected, so
                    each citation chip opens the most-relevant entity profile
                    (the first entity the agent loaded for this question). */}
                {(agentResp.citations?.length > 0 ||
                  (agentResp.entities_accessed?.length ?? 0) > 0) && (
                  <div
                    style={{
                      marginTop: 14,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      className="mono"
                      style={{
                        fontSize: 10,
                        color: "var(--fg-dim)",
                        textTransform: "uppercase",
                        letterSpacing: 0.04,
                      }}
                    >
                      cited from
                    </span>
                    {/* Entity chips first — these are always navigable */}
                    {agentResp.entities_accessed
                      ?.slice(0, 4)
                      .map((eid) => (
                        <button
                          key={eid}
                          onClick={() => onOpenEntity?.(eid)}
                          disabled={!onOpenEntity}
                          title={
                            onOpenEntity
                              ? `Open ${eid}'s profile`
                              : eid
                          }
                          className="mono"
                          style={{
                            fontSize: 10.5,
                            padding: "3px 8px",
                            borderRadius: 999,
                            border: "1px solid var(--brand-line)",
                            background: "var(--brand-wash)",
                            color: "var(--brand)",
                            cursor: onOpenEntity ? "pointer" : "default",
                            fontFamily: "inherit",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <span style={{ fontSize: 9, opacity: 0.65 }}>
                            {eid.split(":")[0]}
                          </span>
                          {eid.split(":").slice(1).join(":")}
                          {onOpenEntity && <span style={{ opacity: 0.7 }}>→</span>}
                        </button>
                      ))}
                    {/* Then citation labels — display only since we can't link
                        them to a specific source from the LLM output alone */}
                    {agentResp.citations?.slice(0, 4).map((c, i) => (
                      <span
                        key={i}
                        className="mono"
                        title={c}
                        style={{
                          fontSize: 10,
                          padding: "3px 8px",
                          borderRadius: 999,
                          border: "1px solid var(--border-muted)",
                          background: "var(--bg-elevated)",
                          color: "var(--fg-muted)",
                          maxWidth: 200,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        ^[{c.slice(0, 30)}]
                      </span>
                    ))}
                  </div>
                )}

                {agentResp.suggestions?.length > 0 && (
                  <>
                    <div
                      className="mono"
                      style={{
                        fontSize: 10,
                        color: "var(--fg-dim)",
                        textTransform: "uppercase",
                        letterSpacing: 0.04,
                        margin: "18px 0 4px",
                      }}
                    >
                      Suggested next actions
                    </div>
                    <p
                      style={{
                        margin: "0 0 10px",
                        fontSize: 11,
                        color: "var(--fg-muted)",
                        fontStyle: "italic",
                        fontFamily: "var(--font-serif)",
                      }}
                    >
                      The agent picked these from your open recommendations + the
                      question you asked. Click one to ask the agent to walk
                      through it next.
                    </p>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {agentResp.suggestions.slice(0, 5).map((s, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            const followUp = s.detail
                              ? `${s.label} — ${s.detail}`
                              : s.label;
                            setQuery(followUp);
                            // Re-run the agent with the suggestion as the
                            // question so the user gets the next breakdown.
                            setTimeout(() => askAgent(), 30);
                          }}
                          title={s.detail ?? s.label}
                          style={{
                            padding: "5px 10px",
                            borderRadius: 6,
                            border: "1px solid " + (i === 0 ? "var(--brand)" : "var(--border-muted)"),
                            background: i === 0 ? "var(--brand-wash)" : "var(--bg)",
                            color: i === 0 ? "var(--brand)" : "var(--fg)",
                            fontSize: 12,
                            cursor: "pointer",
                            fontFamily: "inherit",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <span style={{ fontSize: 10, opacity: 0.7, textTransform: "uppercase", letterSpacing: 0.04 }}>
                            {s.type}
                          </span>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {/* Feedback row — feeds the self-improvement loop */}
                <div
                  style={{
                    marginTop: 16,
                    paddingTop: 12,
                    borderTop: "1px dashed var(--border-muted)",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: "var(--fg-dim)",
                      textTransform: "uppercase",
                      letterSpacing: 0.04,
                    }}
                  >
                    Helpful?
                  </span>
                  <button
                    onClick={() => sendFeedback("up")}
                    disabled={feedback !== null}
                    aria-label="Mark answer helpful"
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      border:
                        "1px solid " +
                        (feedback === "up" ? "var(--brand)" : "var(--border)"),
                      background:
                        feedback === "up" ? "var(--brand-wash)" : "transparent",
                      color: feedback === "up" ? "var(--brand)" : "var(--fg-muted)",
                      cursor: feedback === null ? "pointer" : "default",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "inherit",
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M3 7h2v6H3V7zm3 0V4.5C6 3.7 6.7 3 7.5 3S9 3.7 9 4.5V7h3.5c.8 0 1.5.7 1.4 1.5l-.6 4c-.1.6-.6 1-1.2 1H6V7z"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        fill="none"
                      />
                    </svg>
                  </button>
                  <button
                    onClick={() => sendFeedback("down")}
                    disabled={feedback !== null}
                    aria-label="Mark answer unhelpful"
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      border:
                        "1px solid " +
                        (feedback === "down" ? "var(--rep-avoid)" : "var(--border)"),
                      background:
                        feedback === "down" ? "rgba(153,27,27,0.07)" : "transparent",
                      color: feedback === "down" ? "var(--rep-avoid)" : "var(--fg-muted)",
                      cursor: feedback === null ? "pointer" : "default",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "inherit",
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M3 9h2V3H3v6zm3 0v2.5c0 .8.7 1.5 1.5 1.5S9 12.3 9 11.5V9h3.5c.8 0 1.5-.7 1.4-1.5l-.6-4c-.1-.6-.6-1-1.2-1H6v6z"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        fill="none"
                      />
                    </svg>
                  </button>
                  {feedback && feedbackNote && (
                    <span
                      className="mono"
                      style={{
                        fontSize: 10,
                        color:
                          feedback === "up" ? "var(--brand)" : "var(--rep-avoid)",
                      }}
                    >
                      ✓ {feedbackNote}
                    </span>
                  )}
                  <span style={{ flex: 1 }} />
                  <span
                    className="mono"
                    style={{ fontSize: 10, color: "var(--fg-dim)" }}
                  >
                    {agentResp.facts_used} facts · {agentResp.latency_ms}ms
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PaletteRow({
  glyph,
  name,
  sub,
  tag,
  tagSev,
  highlighted,
  onSelect,
}: {
  glyph: string;
  name: string;
  sub: string;
  tag?: string;
  tagSev?: "critical" | "high" | "medium" | "ok";
  highlighted?: boolean;
  onSelect?: () => void;
}) {
  const tagColor: Record<string, string> = {
    critical: "var(--critical)",
    high: "var(--high)",
    medium: "var(--fg-muted)",
    ok: "var(--brand)",
  };
  return (
    <button
      onClick={onSelect}
      style={{
        display: "grid",
        gridTemplateColumns: "20px 1fr auto",
        gap: 12,
        width: "100%",
        padding: "8px 8px",
        alignItems: "center",
        background: highlighted ? "var(--brand-wash)" : "transparent",
        border: "none",
        borderRadius: 6,
        cursor: "pointer",
        textAlign: "left",
        marginBottom: 2,
        color: "var(--fg)",
        fontFamily: "inherit",
      }}
    >
      <Glyph type={glyph} size={13} color={highlighted ? "var(--brand)" : "var(--fg-muted)"} />
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontSize: 13,
            color: "var(--fg)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </span>
        <span className="mono" style={{ fontSize: 10, color: "var(--fg-dim)" }}>
          {sub}
        </span>
      </div>
      {tag && (
        <span
          className="mono"
          style={{ fontSize: 10, color: tagColor[tagSev ?? "medium"] }}
        >
          {tag}
        </span>
      )}
    </button>
  );
}

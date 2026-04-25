// path: src/app/dashboard/page.tsx
"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { Nav } from "@/components/Nav";

// ── Types ───────────────────────────────────────────────────────────────────

type Entity = { id: string; type: string; name: string };

type AgentStep = { type: string; content: string; ts: string };
type AgentSuggestion = {
  type: string; label: string; detail?: string; draft_context?: unknown;
};
type AgentResponse = {
  answer: string; citations: string[]; steps: AgentStep[];
  suggestions: AgentSuggestion[]; entities_accessed: string[];
  facts_used: number; model: string; latency_ms: number;
  transcription?: { text: string; latency_ms: number; model: string };
};

type Message = {
  role: "user" | "agent";
  text: string;
  response?: AgentResponse;
  ts: string;
};

type DraftResult = {
  subject: string; body: string; to: string; to_email: string;
  latency_ms: number; model: string;
};

// ── Page ────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [draftResult, setDraftResult] = useState<DraftResult | null>(null);
  const [showThinking, setShowThinking] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Load entities
  useEffect(() => {
    fetch("/api/entities")
      .then(r => r.json())
      .then(d => setEntities(d.entities ?? []));
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Send text message ─────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", text, ts: new Date().toISOString() }]);
    setLoading(true);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          entity_id: selectedEntity || undefined,
          history: messages.slice(-6).map(m => ({ role: m.role, text: m.text })),
        }),
      });
      const data: AgentResponse = await res.json();
      setMessages(prev => [...prev, {
        role: "agent",
        text: data.answer ?? data.error ?? "Keine Antwort",
        response: data,
        ts: new Date().toISOString(),
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: "agent",
        text: `Fehler: ${err instanceof Error ? err.message : String(err)}`,
        ts: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, selectedEntity, messages]);

  // ── Voice recording ───────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size < 100) return;

        setLoading(true);
        setMessages(prev => [...prev, { role: "user", text: "🎤 Sprachaufnahme...", ts: new Date().toISOString() }]);

        const form = new FormData();
        form.append("audio", blob, "recording.webm");
        if (selectedEntity) form.append("entity_id", selectedEntity);

        try {
          const res = await fetch("/api/agent/voice", { method: "POST", body: form });
          const data: AgentResponse = await res.json();

          // Update the user message with the transcription
          setMessages(prev => {
            const updated = [...prev];
            const last = updated.findLastIndex(m => m.role === "user" && m.text.includes("🎤"));
            if (last >= 0) {
              updated[last] = { ...updated[last], text: `🎤 "${data.transcription?.text ?? "..."}"` };
            }
            return [...updated, {
              role: "agent",
              text: data.answer ?? data.error ?? "Keine Antwort",
              response: data,
              ts: new Date().toISOString(),
            }];
          });
        } catch (err) {
          setMessages(prev => [...prev, {
            role: "agent",
            text: `Sprachfehler: ${err instanceof Error ? err.message : String(err)}`,
            ts: new Date().toISOString(),
          }]);
        } finally {
          setLoading(false);
        }
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch {
      alert("Mikrofon nicht verfügbar");
    }
  }, [selectedEntity]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }, []);

  // ── Draft action ──────────────────────────────────────────────────
  const executeDraft = useCallback(async (ctx: unknown) => {
    setDraftResult(null);
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ctx),
      });
      setDraftResult(await res.json());
    } catch {
      // ignore
    }
  }, []);

  // ── Entity groups for selector ────────────────────────────────────
  const entityGroups = [
    { label: "Einheiten", type: "unit", items: entities.filter(e => e.type === "unit").slice(0, 20) },
    { label: "Mieter", type: "tenant", items: entities.filter(e => e.type === "tenant") },
    { label: "Eigentümer", type: "owner", items: entities.filter(e => e.type === "owner").slice(0, 15) },
    { label: "Dienstleister", type: "contractor", items: entities.filter(e => e.type === "contractor") },
  ];

  return (
    <>
      <Nav />
      <div className="flex h-[calc(100vh-56px)]">
        {/* Left sidebar: entity selector */}
        <aside
          className="w-64 shrink-0 overflow-y-auto border-r p-4"
          style={{ borderColor: "var(--border)", background: "var(--bg)" }}
        >
          <div className="mb-4">
            <button
              onClick={() => setSelectedEntity("")}
              className="w-full text-left px-3 py-2 rounded text-[12px] font-mono transition-colors"
              style={{
                background: !selectedEntity ? "var(--brand-wash)" : "transparent",
                color: !selectedEntity ? "var(--brand)" : "var(--fg-muted)",
              }}
            >
              Alle Entitäten
            </button>
          </div>
          {entityGroups.map(g => (
            <div key={g.type} className="mb-4">
              <h3 className="text-[10px] font-mono uppercase tracking-wider px-3 mb-1" style={{ color: "var(--fg-dim)" }}>
                {g.label} ({g.items.length})
              </h3>
              <div className="space-y-0.5">
                {g.items.map(e => (
                  <button
                    key={e.id}
                    onClick={() => setSelectedEntity(e.id)}
                    className="w-full text-left px-3 py-1.5 rounded text-[11px] transition-colors truncate"
                    style={{
                      background: selectedEntity === e.id ? "var(--brand-wash)" : "transparent",
                      color: selectedEntity === e.id ? "var(--brand)" : "var(--fg-muted)",
                    }}
                  >
                    {e.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        {/* Main chat area */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="px-6 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
            <div>
              <h1 className="text-[16px] font-semibold" style={{ color: "var(--fg)" }}>
                Hausbuch Agent
              </h1>
              <p className="text-[11px] font-mono" style={{ color: "var(--fg-dim)" }}>
                {selectedEntity
                  ? entities.find(e => e.id === selectedEntity)?.name ?? selectedEntity
                  : "WEG Immanuelkirchstraße 26"
                }
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowThinking(v => !v)}
                className="text-[11px] font-mono px-2 py-1 rounded"
                style={{
                  background: showThinking ? "var(--brand-wash)" : "var(--bg-hover)",
                  color: showThinking ? "var(--brand)" : "var(--fg-dim)",
                }}
              >
                {showThinking ? "Denken sichtbar" : "Denken verborgen"}
              </button>
              <Link href="/inbox" className="text-[11px] font-mono px-2 py-1 rounded" style={{ background: "var(--bg-hover)", color: "var(--fg-dim)" }}>
                Vorgangsliste →
              </Link>
              <Link href="/audit" className="text-[11px] font-mono px-2 py-1 rounded" style={{ background: "var(--bg-hover)", color: "var(--fg-dim)" }}>
                Audit →
              </Link>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-16">
                <p className="text-[15px] mb-2" style={{ color: "var(--fg-muted)" }}>
                  Fragen Sie den Hausbuch-Agent
                </p>
                <div className="space-y-2 text-[13px]" style={{ color: "var(--fg-dim)" }}>
                  <p>Beispiele:</p>
                  <button onClick={() => { setInput("Was ist der aktuelle Stand bei der Schimmelmeldung in WE 32?"); }} className="block mx-auto px-4 py-2 rounded border text-left" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
                    Was ist der Stand bei der Schimmelmeldung in WE 32?
                  </button>
                  <button onClick={() => { setInput("Die Haustür von Haus 16 ist repariert. Handwerker Mueller war heute da."); }} className="block mx-auto px-4 py-2 rounded border text-left" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
                    Haustür Haus 16 repariert. Mueller war heute da.
                  </button>
                  <button onClick={() => { setInput("Wer hat in den letzten 3 Monaten eine Kündigung eingereicht?"); }} className="block mx-auto px-4 py-2 rounded border text-left" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
                    Wer hat kürzlich eine Kündigung eingereicht?
                  </button>
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className="rounded-lg px-4 py-3 max-w-[80%]"
                  style={{
                    background: m.role === "user" ? "var(--brand)" : "var(--bg-elevated)",
                    color: m.role === "user" ? "white" : "var(--fg)",
                    border: m.role === "agent" ? "1px solid var(--border)" : "none",
                  }}
                >
                  {/* Agent thinking steps */}
                  {m.role === "agent" && showThinking && m.response?.steps && (
                    <div className="mb-3 space-y-1 pb-3 border-b" style={{ borderColor: "var(--border)" }}>
                      {m.response.steps.map((s, j) => (
                        <div key={j} className="flex items-center gap-2 text-[10px] font-mono" style={{ color: "var(--fg-dim)" }}>
                          <span style={{ color: stepColor(s.type) }}>{stepIcon(s.type)}</span>
                          <span>{s.content}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Message text */}
                  <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{m.text}</div>

                  {/* Suggestions */}
                  {m.role === "agent" && m.response?.suggestions && m.response.suggestions.length > 0 && (
                    <div className="mt-3 pt-3 border-t space-y-1.5" style={{ borderColor: "var(--border)" }}>
                      <div className="text-[10px] font-mono" style={{ color: "var(--fg-dim)" }}>Empfohlene Aktionen:</div>
                      {m.response.suggestions.map((s, j) => (
                        <button
                          key={j}
                          onClick={() => s.draft_context ? executeDraft(s.draft_context) : null}
                          className="block w-full text-left px-3 py-2 rounded text-[12px] transition-colors"
                          style={{ background: "var(--bg-hover)", color: "var(--fg-muted)" }}
                        >
                          <span style={{ color: suggestionColor(s.type) }}>{suggestionIcon(s.type)}</span>
                          {" "}{s.label}
                          {s.detail && <span className="block text-[10px] mt-0.5" style={{ color: "var(--fg-dim)" }}>{s.detail}</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Meta */}
                  {m.role === "agent" && m.response && (
                    <div className="mt-2 flex gap-3 text-[10px] font-mono" style={{ color: "var(--fg-dim)" }}>
                      <span>{m.response.model}</span>
                      <span>{m.response.latency_ms}ms</span>
                      <span>{m.response.facts_used} Fakten</span>
                      {m.response.transcription && (
                        <span style={{ color: "var(--brand)" }}>Gradium {m.response.transcription.latency_ms}ms</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="rounded-lg px-4 py-3" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                  <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--fg-dim)" }}>
                    <span className="animate-pulse">●</span> Agent denkt nach...
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input bar */}
          <div className="px-6 py-4 border-t" style={{ borderColor: "var(--border)" }}>
            <div className="flex gap-2">
              <button
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={stopRecording}
                className="px-4 py-2.5 rounded-lg text-[14px] transition-colors shrink-0"
                style={{
                  background: recording ? "var(--danger)" : "var(--bg-elevated)",
                  color: recording ? "white" : "var(--fg-muted)",
                  border: "1px solid var(--border)",
                }}
                title="Halten zum Sprechen (Gradium)"
              >
                {recording ? "● REC" : "🎤"}
              </button>
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder="Frage stellen oder Update eingeben..."
                className="flex-1 px-4 py-2.5 rounded-lg text-[14px]"
                style={{
                  background: "var(--bg-elevated)",
                  color: "var(--fg)",
                  border: "1px solid var(--border)",
                  outline: "none",
                }}
                disabled={loading}
              />
              <button
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                className="px-6 py-2.5 rounded-lg text-[14px] font-medium transition-colors shrink-0"
                style={{
                  background: "var(--brand)",
                  color: "white",
                  opacity: loading || !input.trim() ? 0.5 : 1,
                }}
              >
                Senden
              </button>
            </div>
          </div>
        </main>
      </div>

      {/* Draft result modal */}
      {draftResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setDraftResult(null)}>
          <div className="rounded-lg border p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto" style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px] font-semibold" style={{ color: "var(--fg)" }}>E-Mail-Entwurf</h3>
              <button onClick={() => setDraftResult(null)} className="text-[20px]" style={{ color: "var(--fg-dim)" }}>×</button>
            </div>
            <div className="text-[12px] font-mono mb-3 space-y-1" style={{ color: "var(--fg-dim)" }}>
              <div>An: {draftResult.to} &lt;{draftResult.to_email}&gt;</div>
              <div>Betreff: {draftResult.subject}</div>
            </div>
            <pre className="text-[13px] p-4 rounded whitespace-pre-wrap leading-relaxed" style={{ background: "var(--bg)", color: "var(--fg)", fontFamily: "inherit" }}>
              {draftResult.body}
            </pre>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-[10px] font-mono" style={{ color: "var(--fg-dim)" }}>{draftResult.model} · {draftResult.latency_ms}ms</span>
              <button className="ml-auto px-4 py-1.5 rounded text-[12px] font-medium" style={{ background: "var(--brand)", color: "white" }} onClick={() => navigator.clipboard.writeText(draftResult.body)}>
                Kopieren
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function stepIcon(type: string): string {
  return { thinking: "◇", searching: "⊕", analyzing: "◈", answering: "▸", suggesting: "→", learning: "✓" }[type] ?? "·";
}
function stepColor(type: string): string {
  return { thinking: "var(--fg-dim)", searching: "#0c4a6e", analyzing: "#7c3aed", answering: "var(--brand)", suggesting: "#b45309", learning: "var(--success)" }[type] ?? "var(--fg-dim)";
}
function suggestionIcon(type: string): string {
  return { draft_email: "✉", dispatch: "📤", escalate: "⚖", follow_up: "→", investigate: "🔍" }[type] ?? "·";
}
function suggestionColor(type: string): string {
  return { draft_email: "var(--brand)", dispatch: "#b45309", escalate: "#991b1b", follow_up: "#0c4a6e", investigate: "#7c3aed" }[type] ?? "var(--fg-dim)";
}

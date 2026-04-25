// path: src/components/FileDropZone.tsx
"use client";

import { useRef, useState, type DragEvent, type ChangeEvent } from "react";

type UploadResult = {
  name: string;
  size: number;
  kind: string;
  facts: number;
  conflicts: number;
  latency_ms: number;
  extract_preview: string;
  error?: string;
};

type Props = {
  onIngested?: () => void;
};

export function FileDropZone({ onIngested }: Props) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList) => {
    if (files.length === 0) return;
    setUploading(true);
    const form = new FormData();
    for (const f of Array.from(files)) form.append("files", f);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = (await res.json()) as { uploaded: UploadResult[] };
      setResults(data.uploaded);
      onIngested?.();
    } catch (err) {
      setResults([
        {
          name: "upload failed",
          size: 0,
          kind: "unknown",
          facts: 0,
          conflicts: 0,
          latency_ms: 0,
          extract_preview: "",
          error: String(err),
        },
      ]);
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(true);
  };

  const onDragLeave = () => setDragging(false);

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files);
  };

  return (
    <div className="space-y-3">
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => inputRef.current?.click()}
        className="rounded-lg p-6 cursor-pointer transition-all text-center"
        style={{
          background: dragging ? "rgba(232, 178, 107, 0.08)" : "var(--bg)",
          border: `2px dashed ${dragging ? "var(--amber)" : "var(--line-bright)"}`,
        }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept=".txt,.md,.eml,.pdf,.json,.jsonl"
          onChange={onInputChange}
        />
        <div className="font-serif text-xl mb-2" style={{ color: "var(--amber-bright)" }}>
          {uploading ? "Ingesting…" : "Drop a file or click to upload"}
        </div>
        <div className="text-[12px] font-mono" style={{ color: "var(--ink-dim)" }}>
          .pdf · .eml · .txt · .md · .json · one or many at once
        </div>
        <div className="text-[11px] mt-3" style={{ color: "var(--ink-muted)" }}>
          Judge mode: drop your own document. Hausbuch extracts facts, reconciles against what it
          already knows, renders a new <code className="font-mono">Context.md</code>. The agents
          above will re-query.
        </div>
      </div>

      {results.length > 0 && (
        <div
          className="rounded-lg p-4 space-y-3"
          style={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }}
        >
          <div
            className="text-[10px] font-mono uppercase tracking-wider"
            style={{ color: "var(--ink-dim)" }}
          >
            ingest result · {results.length} file{results.length === 1 ? "" : "s"}
          </div>
          {results.map((r, i) => (
            <div
              key={i}
              className="flex items-start gap-3 text-[12px] font-mono"
              style={{ color: "var(--ink)" }}
            >
              <div
                className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                style={{
                  background: r.error ? "#d68572" : r.conflicts > 0 ? "#f0a868" : "#8fd280",
                  boxShadow: `0 0 6px ${r.error ? "rgba(214,133,114,0.5)" : r.conflicts > 0 ? "rgba(240,168,104,0.5)" : "rgba(143,210,128,0.5)"}`,
                }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span style={{ color: "var(--amber-bright)" }}>{r.name}</span>
                  <span className="text-[10px]" style={{ color: "var(--ink-dim)" }}>
                    {r.kind} · {(r.size / 1024).toFixed(1)}KB
                  </span>
                </div>
                {r.error ? (
                  <div style={{ color: "#d68572" }}>error: {r.error}</div>
                ) : (
                  <div style={{ color: "var(--ink-muted)" }}>
                    extracted {r.facts} fact{r.facts === 1 ? "" : "s"}
                    {r.conflicts > 0 ? ` · ${r.conflicts} conflict${r.conflicts === 1 ? "" : "s"} detected` : ""}
                    {" · "}
                    {r.latency_ms}ms
                  </div>
                )}
                <div
                  className="text-[11px] mt-1 truncate"
                  style={{ color: "var(--ink-dim)" }}
                >
                  &ldquo;{r.extract_preview}&rdquo;
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

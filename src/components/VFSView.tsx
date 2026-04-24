// path: src/components/VFSView.tsx
// path: src/components/VFSView.tsx
"use client";

import { useEffect, useState } from "react";

type VFSNode = {
  name: string;
  kind: "dir" | "file";
  size_hint?: string;
  ref?: string;
  children?: VFSNode[];
};

export function VFSView() {
  const [root, setRoot] = useState<VFSNode | null>(null);

  useEffect(() => {
    fetch("/api/graph?vfs=1")
      .then((r) => r.json())
      .then(setRoot);
  }, []);

  if (!root) return <div className="font-mono text-[12px]" style={{ color: "var(--ink-dim)" }}>loading VFS…</div>;

  return (
    <div
      className="rounded-lg p-5 font-mono text-[12px] leading-relaxed overflow-x-auto"
      style={{ background: "var(--bg-raised)", border: "1px solid var(--line)", color: "var(--ink)" }}
    >
      <Node node={root} depth={0} />
    </div>
  );
}

function Node({ node, depth, last }: { node: VFSNode; depth: number; last?: boolean }) {
  const indent = "│   ".repeat(Math.max(0, depth - 1));
  const branch = depth === 0 ? "" : last ? "└── " : "├── ";
  return (
    <>
      <div>
        <span style={{ color: "var(--ink-dim)" }}>{indent}{branch}</span>
        {node.kind === "dir" ? (
          <span style={{ color: "var(--amber-bright)" }}>{node.name}{node.name === "/" ? "" : "/"}</span>
        ) : (
          <>
            <span style={{ color: "var(--ink)" }}>{node.name}</span>
            {node.ref ? (
              <a href={node.ref} target="_blank" className="ml-2" style={{ color: "var(--amber)" }}>
                ↗
              </a>
            ) : null}
            {node.size_hint ? (
              <span className="ml-2" style={{ color: "var(--ink-dim)" }}>({node.size_hint})</span>
            ) : null}
          </>
        )}
      </div>
      {node.children?.map((child, i) => (
        <Node
          key={`${node.name}-${child.name}-${i}`}
          node={child}
          depth={depth + 1}
          last={i === (node.children?.length ?? 0) - 1}
        />
      ))}
    </>
  );
}

// path: src/components/HausbuchMark.tsx
export function HausbuchMark({ size = 16 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative" style={{ width: size, height: size }}>
        <div
          className="absolute inset-0 rounded-full glow-pulse"
          style={{
            background:
              "radial-gradient(circle, var(--amber-bright) 0%, var(--amber) 40%, transparent 80%)",
            filter: "blur(4px)",
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            inset: size * 0.2,
            background: "var(--amber-bright)",
            boxShadow: "0 0 12px var(--amber), 0 0 24px var(--amber-glow)",
          }}
        />
      </div>
      <span
        className="font-serif italic tracking-tight"
        style={{ fontSize: size * 1.15, lineHeight: 1 }}
      >
        Hausbuch
      </span>
    </div>
  );
}

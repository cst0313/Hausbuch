// path: src/components/HausbuchMark.tsx
type Props = { size?: number; showText?: boolean };

export function HausbuchMark({ size = 18, showText = true }: Props) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        role="img"
        aria-label={showText ? undefined : "Hausbuch"}
        aria-hidden={showText ? "true" : undefined}
      >
        {/* A roof over a stable baseline — "house book" glyph */}
        <path
          d="M3 11 L12 4 L21 11"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect
          x="5"
          y="11"
          width="14"
          height="9"
          rx="1"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <line
          x1="8"
          y1="15"
          x2="16"
          y2="15"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          opacity="0.55"
        />
        <line
          x1="8"
          y1="17.5"
          x2="14"
          y2="17.5"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          opacity="0.35"
        />
      </svg>
      {showText && (
        <span
          className="font-semibold tracking-tight text-[15px]"
          style={{ color: "var(--fg)" }}
        >
          Hausbuch
        </span>
      )}
    </span>
  );
}

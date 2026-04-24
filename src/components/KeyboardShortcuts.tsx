// path: src/components/KeyboardShortcuts.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function KeyboardShortcuts() {
  const router = useRouter();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip if typing in an input/textarea/contenteditable
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === "d") {
        router.push("/demo");
      } else if (e.key === "r") {
        router.push("/research");
      } else if (e.key === "t") {
        router.push("/technical");
      } else if (e.key === "p") {
        router.push("/protocol");
      } else if (e.key === "h" || e.key === "?") {
        router.push("/");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router]);
  return null;
}

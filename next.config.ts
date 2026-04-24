// path: next.config.ts
import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // pdf-parse pulls in pdfjs-dist which spawns a worker via dynamic import.
  // Next's bundler rewrites the worker path and breaks it. Opt both out of
  // bundling so they're resolved from node_modules at runtime.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;

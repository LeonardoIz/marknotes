import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server with only the files it uses: what the Docker image ships (its build sets this;
  // left off otherwise, since `next start` warns about it).
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  outputFileTracingIncludes: {
    // transformers.js loads the model runtime with a require the tracer can't see; only this platform's binary.
    "/*": [
      "node_modules/onnxruntime-node/{package.json,dist/**}",
      "node_modules/onnxruntime-common/**",
      `node_modules/onnxruntime-node/bin/napi-v6/${process.platform}/${process.arch}/**`,
      // shiki → oniguruma-to-es imports these via `exports` pointing at src/ (not dist/): the tracer misses them.
      "node_modules/{regex,regex-recursion,regex-utilities}/{package.json,src/**}",
    ],
  },
  outputFileTracingExcludes: {
    // The notes folder is read at runtime, not shipped (it holds your notes and the downloaded model).
    // GPU providers (CUDA, TensorRT) are never used: the model runs on the CPU.
    "/*": ["data/**", "docs/**", "src/**", "*.md", "node_modules/onnxruntime-node/bin/**/libonnxruntime_providers_*"],
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

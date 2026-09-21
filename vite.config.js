import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

function gitOutput(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function getBuildVersion() {
  const releaseTag =
    process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : "";
  const tag =
    releaseTag || gitOutput(["describe", "--tags", "--exact-match", "HEAD"]);
  if (tag) return tag;

  return (
    process.env.GITHUB_SHA?.slice(0, 7) ||
    gitOutput(["rev-parse", "--short", "HEAD"]) ||
    "unknown"
  );
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],
  define: {
    global: "globalThis",
    "import.meta.env.VITE_BUILD_VERSION": JSON.stringify(getBuildVersion()),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));

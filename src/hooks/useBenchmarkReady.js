import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/useAppStore";

let benchmarkEnabled = false;

export async function initializeBenchmark() {
  benchmarkEnabled = await invoke("benchmark_enabled");
  if (!benchmarkEnabled) return;
  useAppStore.subscribe((state) => {
    if (state.errorMessage) {
      void invoke("finish_benchmark", { error: String(state.errorMessage) });
    }
  });
  window.addEventListener("error", (event) => {
    void invoke("finish_benchmark", { error: event.message });
  });
  window.addEventListener("unhandledrejection", (event) => {
    void invoke("finish_benchmark", { error: String(event.reason) });
  });
}

export function useBenchmarkReady(ready) {
  useEffect(() => {
    if (!benchmarkEnabled || !ready) return undefined;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const error = useAppStore.getState().errorMessage;
        void invoke("finish_benchmark", { error: error ? String(error) : null });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready]);
}

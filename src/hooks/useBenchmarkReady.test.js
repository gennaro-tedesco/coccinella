import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, effectMock, storeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  effectMock: vi.fn(),
  storeMock: { subscribe: vi.fn(), getState: vi.fn() },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("react", () => ({ useEffect: effectMock }));
vi.mock("../store/useAppStore", () => ({ useAppStore: storeMock }));

import { initializeBenchmark, useBenchmarkReady } from "./useBenchmarkReady";

describe("benchmark completion", () => {
  let frames;

  beforeEach(() => {
    vi.clearAllMocks();
    frames = [];
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback) => frames.push(callback)));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    storeMock.getState.mockReturnValue({ errorMessage: null });
  });

  it("waits for readiness and a paint opportunity before exiting", async () => {
    invokeMock.mockResolvedValue(true);
    await initializeBenchmark();
    useBenchmarkReady(false);
    expect(effectMock.mock.calls.at(-1)[0]()).toBeUndefined();
    expect(frames).toHaveLength(0);
    useBenchmarkReady(true);
    const cleanup = effectMock.mock.calls.at(-1)[0]();
    frames.shift()();
    expect(invokeMock).not.toHaveBeenCalledWith("finish_benchmark", expect.anything());
    frames.shift()();
    expect(invokeMock).toHaveBeenCalledWith("finish_benchmark", { error: null });
    cleanup();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it("reports loading failures instead of waiting indefinitely", async () => {
    invokeMock.mockResolvedValue(true);
    await initializeBenchmark();
    storeMock.subscribe.mock.calls[0][0]({ errorMessage: "Invalid CSV" });
    expect(invokeMock).toHaveBeenCalledWith("finish_benchmark", { error: "Invalid CSV" });
  });

  it("does not close normal application sessions", async () => {
    invokeMock.mockResolvedValue(false);
    await initializeBenchmark();
    useBenchmarkReady(true);
    expect(effectMock.mock.calls.at(-1)[0]()).toBeUndefined();
    expect(storeMock.subscribe).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
  });
});

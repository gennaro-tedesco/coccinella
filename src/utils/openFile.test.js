import { beforeEach, describe, expect, it, vi } from "vitest";

const { channels, invokeMock } = vi.hoisted(() => ({
  channels: [],
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    constructor() {
      channels.push(this);
    }
  },
  invoke: invokeMock,
}));

import { useAppStore } from "../store/useAppStore";
import { openFile, openFileAtPath } from "./openFile";

describe("file loading progress", () => {
  beforeEach(() => {
    channels.length = 0;
    invokeMock.mockReset();
    useAppStore.setState({
      fileLoadProgress: null,
      sheets: {},
      sheetOrder: [],
      activeSheetId: null,
      previousSheetId: null,
    });
  });

  it("activates a file whose source path is already loaded", async () => {
    useAppStore.setState({
      sheets: {
        dataset: {
          id: "dataset",
          path: "/tmp/people.csv",
        },
      },
      sheetOrder: ["dataset"],
    });
    const openSheet = vi.fn();
    const openJson = vi.fn();

    await openFileAtPath(
      {
        token: "token",
        path: "~/people.csv",
        sourcePath: "/tmp/people.csv",
      },
      openSheet,
      openJson,
    );

    expect(invokeMock).not.toHaveBeenCalled();
    expect(openSheet).not.toHaveBeenCalled();
    expect(openJson).not.toHaveBeenCalled();
    expect(useAppStore.getState().activeSheetId).toBe("dataset");
  });

  it("activates a duplicate selected from the file dialog", async () => {
    useAppStore.setState({
      sheets: {
        dataset: {
          id: "dataset",
          path: "/tmp/people.csv",
        },
      },
      sheetOrder: ["dataset"],
    });
    invokeMock.mockResolvedValueOnce({
      token: "token",
      path: "/tmp/people.csv",
      sourcePath: "/tmp/people.csv",
    });

    await openFile(vi.fn(), vi.fn());

    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith("open_file_dialog");
    expect(useAppStore.getState().activeSheetId).toBe("dataset");
  });

  it("ignores progress delivered after the load completes", async () => {
    let completeLoad;
    invokeMock.mockReturnValueOnce(
      new Promise((resolve) => {
        completeLoad = resolve;
      }),
    );
    const openSheet = vi.fn();
    const opening = openFileAtPath(
      { token: "token", path: "/tmp/people.csv" },
      openSheet,
      vi.fn(),
      ",",
    );
    const progress = {
      operationId: invokeMock.mock.calls[0][1].operationId,
      filename: "people.csv",
      bytesRead: 10,
      totalBytes: 10,
    };
    channels[0].onmessage(progress);
    expect(useAppStore.getState().fileLoadProgress).toEqual(progress);

    completeLoad({
      kind: "csv",
      filename: "people.csv",
      path: "/tmp/people.csv",
      metadata: { datasetId: "dataset" },
    });
    await opening;
    expect(useAppStore.getState().fileLoadProgress).toBeNull();

    channels[0].onmessage(progress);
    expect(useAppStore.getState().fileLoadProgress).toBeNull();
    expect(openSheet).toHaveBeenCalledOnce();
  });
});

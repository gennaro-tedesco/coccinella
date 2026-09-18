import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { useAppStore } from "./useAppStore";

const initialState = useAppStore.getState();
const rootMetadata = {
  datasetId: "root",
  separator: ",",
  rowCount: 1,
  columns: ["name"],
  columnTypes: { name: "category" },
  sizeBytes: 10,
};
const childMetadata = {
  ...rootMetadata,
  datasetId: "child",
};

describe("application store dataset lifecycle", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useAppStore.setState(initialState, true);
  });

  it("removes child sheets and plot state when the root closes", async () => {
    const store = useAppStore.getState();
    store.openSheet("people.csv", rootMetadata, "/tmp/people.csv");
    invokeMock.mockResolvedValueOnce(childMetadata);
    await useAppStore
      .getState()
      .createFilteredSheet("root", "Ada", false, false);
    useAppStore.getState().setPlotConfig("root", { chartType: "barchart" });
    useAppStore.getState().setPlotConfig("child", { chartType: "countplot" });
    invokeMock.mockResolvedValueOnce(undefined);

    await useAppStore.getState().closeSheet("root");

    expect(useAppStore.getState()).toMatchObject({
      sheets: {},
      sheetOrder: [],
      plotConfig: {},
      activeSheetId: null,
    });
  });

  it("keeps state intact and reports an error when native close fails", async () => {
    useAppStore
      .getState()
      .openSheet("people.csv", rootMetadata, "/tmp/people.csv");
    invokeMock.mockRejectedValueOnce(new Error("close failed"));

    await useAppStore.getState().closeSheet("root");

    expect(useAppStore.getState().sheets.root).toBeDefined();
    expect(useAppStore.getState().errorMessage).toBe("close failed");
  });

  it("ignores obsolete sort results", async () => {
    useAppStore
      .getState()
      .openSheet("people.csv", rootMetadata, "/tmp/people.csv");
    const sorting = [{ id: "name", desc: false }];
    invokeMock.mockResolvedValueOnce(false);

    await useAppStore.getState().setSorting("root", sorting);
    expect(useAppStore.getState().sheets.root.sorting).toEqual([]);

    invokeMock.mockResolvedValueOnce(true);
    await useAppStore.getState().setSorting("root", sorting);
    expect(useAppStore.getState().sheets.root.sorting).toEqual(sorting);
    expect(useAppStore.getState().sheets.root.dataVersion).toBe(1);
  });
});

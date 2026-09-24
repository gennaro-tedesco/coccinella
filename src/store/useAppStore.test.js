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
const grandchildMetadata = {
  ...rootMetadata,
  datasetId: "grandchild",
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

  it("sets and resets a fitted column width without touching other columns", () => {
    useAppStore
      .getState()
      .openSheet("people.csv", rootMetadata, "/tmp/people.csv");

    useAppStore.getState().setColumnWidth("root", "name", 120);
    useAppStore.getState().setColumnWidth("root", "score", 80);
    expect(useAppStore.getState().sheets.root.columnWidths).toEqual({
      name: 120,
      score: 80,
    });

    useAppStore.getState().resetColumnWidth("root", "name");
    expect(useAppStore.getState().sheets.root.columnWidths).toEqual({
      score: 80,
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

  it("opens and closes JSON files without invoking the CSV dataset backend", async () => {
    useAppStore
      .getState()
      .openJson("data.json", "json-1", { user: { name: "Ada" } }, 32, "/tmp/data.json");

    expect(useAppStore.getState().sheets["json-1"]).toMatchObject({
      kind: "json",
      filename: "data.json",
      data: { user: { name: "Ada" } },
    });

    await useAppStore.getState().closeSheet("json-1");

    expect(invokeMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().sheets).toEqual({});
  });

  it("creates and recursively closes filtered descendants", async () => {
    useAppStore
      .getState()
      .openSheet("people.csv", rootMetadata, "/tmp/people.csv");
    invokeMock.mockResolvedValueOnce(childMetadata);
    await useAppStore
      .getState()
      .createFilteredSheet("root", "Ada", false, false);
    invokeMock.mockResolvedValueOnce(grandchildMetadata);
    await useAppStore
      .getState()
      .createFilteredSheet("child", "Lovelace", false, false);

    expect(useAppStore.getState().sheets.root.children).toEqual(["child"]);
    expect(useAppStore.getState().sheets.child.children).toEqual(["grandchild"]);
    expect(useAppStore.getState().activeSheetId).toBe("grandchild");

    invokeMock.mockResolvedValueOnce(undefined);
    await useAppStore.getState().closeFilteredSheet("child");

    expect(useAppStore.getState().sheets).toEqual({
      root: expect.objectContaining({ children: [] }),
    });
    expect(useAppStore.getState().activeSheetId).toBe("root");
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

  it("saves only visible columns using the current sorted view", async () => {
    const metadata = {
      ...rootMetadata,
      columns: ["name", "score"],
      columnTypes: { name: "category", score: "number" },
    };
    useAppStore
      .getState()
      .openSheet("people.csv", metadata, "/tmp/people.csv");
    useAppStore.getState().setColumnVisibility("root", {
      name: true,
      score: false,
    });
    invokeMock.mockResolvedValueOnce(true);
    await useAppStore
      .getState()
      .setSorting("root", [{ id: "name", desc: false }]);
    invokeMock.mockResolvedValueOnce(true);

    const saved = await useAppStore.getState().saveSheetView("root");

    expect(saved).toBe(true);
    expect(invokeMock).toHaveBeenLastCalledWith("save_csv_file_dialog", {
      datasetId: "root",
      defaultName: "people-view.csv",
      columns: ["name"],
    });
  });

  it("reloads the original view for a child sheet", async () => {
    const metadata = {
      ...rootMetadata,
      columns: ["name", "score"],
      columnTypes: { name: "category", score: "number" },
    };
    useAppStore
      .getState()
      .openSheet("people.csv", metadata, "/tmp/people.csv");
    invokeMock.mockResolvedValueOnce({ ...metadata, datasetId: "child" });
    await useAppStore
      .getState()
      .createFilteredSheet("root", "Ada", false, false);
    useAppStore.getState().setColumnVisibility("child", {
      name: false,
      score: true,
    });
    invokeMock.mockResolvedValueOnce(true);
    await useAppStore
      .getState()
      .setSorting("child", [{ id: "score", desc: true }]);
    invokeMock.mockResolvedValueOnce(true);

    const reloaded = await useAppStore.getState().reloadSheetView("child");

    expect(reloaded).toBe(true);
    expect(invokeMock).toHaveBeenLastCalledWith("sort_dataset", {
      datasetId: "child",
      sorting: [],
    });
    expect(useAppStore.getState().sheets.child).toMatchObject({
      columnVisibility: { name: true, score: true },
      sorting: [],
      dataVersion: 2,
    });
  });

  it("creates a joined dataset as a new top-level sheet", async () => {
    useAppStore
      .getState()
      .openSheet("people.csv", rootMetadata, "/tmp/people.csv");
    useAppStore.getState().openSheet(
      "scores.csv",
      { ...rootMetadata, datasetId: "scores" },
      "/tmp/scores.csv",
    );
    invokeMock.mockResolvedValueOnce({
      ...rootMetadata,
      datasetId: "joined",
      columns: ["name", "score"],
      columnTypes: { name: "category", score: "number" },
    });

    const created = await useAppStore
      .getState()
      .createJoinedSheet("root", "scores", ["name"], "left");

    expect(invokeMock).toHaveBeenCalledWith("create_joined_dataset", {
      leftId: "root",
      rightId: "scores",
      columns: ["name"],
      joinType: "left",
    });
    expect(created).toBe(true);
    expect(useAppStore.getState()).toMatchObject({
      sheetOrder: ["root", "scores", "joined"],
      activeSheetId: "joined",
      previousSheetId: "scores",
      sheets: {
        joined: {
          filename: "people.csv + scores.csv",
          columns: ["name", "score"],
        },
      },
    });
  });

  it("creates an appended dataset in the selected order", async () => {
    useAppStore.getState().openSheet("first.csv", rootMetadata, "/tmp/first.csv");
    useAppStore.getState().openSheet(
      "second.csv",
      { ...rootMetadata, datasetId: "second" },
      "/tmp/second.csv",
    );
    invokeMock.mockResolvedValueOnce({ ...rootMetadata, datasetId: "appended", rowCount: 2 });

    const created = await useAppStore.getState().createAppendedSheet(["second", "root"]);

    expect(invokeMock).toHaveBeenCalledWith("create_appended_dataset", {
      datasetIds: ["second", "root"],
    });
    expect(created).toBe(true);
    expect(useAppStore.getState().sheets.appended.filename).toBe("Append: second.csv, first.csv");
  });

  it("creates an aggregated dataset with aggregations and groups", async () => {
    useAppStore.getState().openSheet("people.csv", rootMetadata, "/tmp/people.csv");
    invokeMock.mockResolvedValueOnce({
      ...rootMetadata,
      datasetId: "aggregated",
      columns: ["count of name"],
      columnTypes: { "count of name": "number" },
    });
    const aggregations = [{ column: "name", function: "count" }];

    const created = await useAppStore
      .getState()
      .createAggregatedSheet("root", aggregations, ["country"], true);

    expect(invokeMock).toHaveBeenCalledWith("create_aggregated_dataset", {
      datasetId: "root",
      aggregations,
      groupBy: ["country"],
      pivotTable: true,
    });
    expect(created).toBe(true);
    expect(useAppStore.getState().sheets.aggregated).toMatchObject({
      filename: "Pivot: people.csv",
      pivotTable: true,
      pivotDimensions: ["country"],
    });
  });

  it("creates a dataset with a column computed from number columns", async () => {
    useAppStore.getState().openSheet(
      "prices.csv",
      { ...rootMetadata, columns: ["name", "price"], columnTypes: { name: "category", price: "number" } },
      "/tmp/prices.csv",
    );
    invokeMock.mockResolvedValueOnce({
      ...rootMetadata,
      datasetId: "computed",
      columns: ["name", "price", "double"],
      columnTypes: { name: "category", price: "number", double: "number" },
    });

    const created = await useAppStore.getState().createColumnSheet("root", " double ", "$price * 2");

    expect(invokeMock).toHaveBeenCalledWith("create_column_dataset", {
      datasetId: "root",
      name: " double ",
      expression: "$price * 2",
      numberColumns: ["price"],
    });
    expect(created).toBe(true);
    expect(useAppStore.getState().sheets.computed.filename).toBe("prices.csv + double");
  });
});

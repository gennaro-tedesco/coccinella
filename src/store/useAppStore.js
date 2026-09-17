// Owns application state for opened CSV sheets, display settings, and plots.
// FEATURE: CSV data workspace
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export const useAppStore = create((set, get) => ({
  mode: "data",
  setMode: (mode) => set({ mode }),

  theme: "oceanic",
  setTheme: (theme) => set({ theme }),

  sheetPanelOpen: true,
  toggleSheetPanel: () =>
    set((state) => ({ sheetPanelOpen: !state.sheetPanelOpen })),

  columnPanelOpen: true,
  toggleColumnPanel: () =>
    set((state) => ({ columnPanelOpen: !state.columnPanelOpen })),
  hoveredColumn: null,
  setHoveredColumn: (column) => set({ hoveredColumn: column }),

  sheets: {},
  sheetOrder: [],
  activeSheetId: null,
  previousSheetId: null,
  plotConfig: {},

  searchOpen: false,
  searchQuery: "",
  searchIsRegex: true,
  searchIsCaseSensitive: false,
  searchActiveIndex: 0,
  searchMatchCount: 0,
  activeSearchMatch: null,
  searchVersion: 0,
  openSearch: () =>
    set({ searchOpen: true, searchQuery: "", searchActiveIndex: 0 }),
  closeSearch: () => set({ searchOpen: false }),
  setSearchQuery: (query) =>
    set({
      searchQuery: query,
      searchActiveIndex: 0,
      searchMatchCount: 0,
      activeSearchMatch: null,
    }),
  setSearchIsRegex: (isRegex) =>
    set({
      searchIsRegex: isRegex,
      searchActiveIndex: 0,
      searchMatchCount: 0,
      activeSearchMatch: null,
    }),
  setSearchIsCaseSensitive: (isCaseSensitive) =>
    set({
      searchIsCaseSensitive: isCaseSensitive,
      searchActiveIndex: 0,
      searchMatchCount: 0,
      activeSearchMatch: null,
    }),
  setSearchActiveIndex: (index) => set({ searchActiveIndex: index }),
  setSearchMatchCount: (searchMatchCount) =>
    set((state) => ({
      searchMatchCount,
      searchVersion: state.searchVersion + 1,
    })),
  setActiveSearchMatch: (activeSearchMatch) => set({ activeSearchMatch }),

  openSheet: (filename, metadata, path) =>
    set((state) => {
      const id = metadata.datasetId;
      const columnVisibility = {};
      const columnPrecision = {};
      for (const column of metadata.columns) {
        columnVisibility[column] = true;
        columnPrecision[column] = 2;
      }
      return {
        sheets: {
          ...state.sheets,
          [id]: {
            id,
            filename,
            path: path ?? null,
            datasetId: metadata.datasetId,
            separator: metadata.separator,
            rowCount: metadata.rowCount,
            columns: metadata.columns,
            sourceColumns: metadata.columns,
            columnVisibility,
            columnTypes: metadata.columnTypes,
            columnPrecision,
            selectedColumns: [],
            sorting: [],
            versions: [],
            children: [],
            filterOf: null,
            sizeBytes: metadata.sizeBytes,
            dataVersion: 0,
            contentVersion: 0,
          },
        },
        sheetOrder: [...state.sheetOrder, id],
        activeSheetId: id,
        previousSheetId: state.activeSheetId,
      };
    }),

  rescanSheet: (sheetId, separator, metadataList) =>
    set((state) => {
      const sheet = state.sheets[sheetId];
      if (!sheet) return state;
      const sheets = { ...state.sheets };
      for (const metadata of metadataList) {
        const existing = sheets[metadata.datasetId];
        if (!existing) continue;
        const columnVisibility = Object.fromEntries(
          metadata.columns.map((column) => [column, true]),
        );
        const columnPrecision = Object.fromEntries(
          metadata.columns.map((column) => [column, 2]),
        );
        sheets[metadata.datasetId] = {
          ...existing,
          separator,
          rowCount: metadata.rowCount,
          columns: metadata.columns,
          sourceColumns: metadata.columns,
          columnVisibility,
          columnTypes: metadata.columnTypes,
          columnPrecision,
          selectedColumns:
            metadata.datasetId === sheetId ? [] : existing.selectedColumns,
          sorting: existing.sorting,
          sizeBytes: metadata.sizeBytes,
          dataVersion: existing.dataVersion + 1,
          contentVersion: existing.contentVersion + 1,
        };
      }

      return { sheets };
    }),

  createFilteredSheet: async (sourceId, pattern, isRegex, isCaseSensitive) => {
    const source = get().sheets[sourceId];
    if (!source) return;
    const metadata = await invoke("create_filtered_dataset", {
      sourceId: source.datasetId,
      pattern,
      isRegex,
      isCaseSensitive,
      columns: source.selectedColumns,
    });
    if (!metadata) return;
    set((state) => {
      const currentSource = state.sheets[sourceId];
      if (!currentSource) return state;
      const id = metadata.datasetId;
      const child = {
        id,
        filename: `${source.filename} : ${pattern}`,
        path: null,
        datasetId: metadata.datasetId,
        separator: metadata.separator,
        rowCount: metadata.rowCount,
        columns: metadata.columns,
        sourceColumns: metadata.columns,
        columnVisibility: { ...source.columnVisibility },
        columnTypes: metadata.columnTypes,
        columnPrecision: { ...source.columnPrecision },
        selectedColumns: [],
        sorting: [],
        versions: [],
        children: [],
        filterOf: {
          sourceId,
          pattern,
          isRegex,
          isCaseSensitive,
          columns: source.selectedColumns,
        },
        sizeBytes: metadata.sizeBytes,
        dataVersion: 0,
        contentVersion: 0,
      };

      return {
        sheets: {
          ...state.sheets,
          [sourceId]: {
            ...currentSource,
            children: [...currentSource.children, id],
          },
          [id]: child,
        },
        activeSheetId: id,
        previousSheetId: state.activeSheetId,
      };
    });
  },

  closeFilteredSheet: (id) =>
    set((state) => {
      const child = state.sheets[id];
      if (!child || !child.filterOf) return state;
      const sourceId = child.filterOf.sourceId;
      void invoke("close_dataset", { datasetId: child.datasetId });
      const source = state.sheets[sourceId];
      const sheets = { ...state.sheets };
      delete sheets[id];
      if (source) {
        sheets[sourceId] = {
          ...source,
          children: source.children.filter((childId) => childId !== id),
        };
      }
      return {
        sheets,
        activeSheetId:
          state.activeSheetId === id ? sourceId : state.activeSheetId,
        previousSheetId:
          state.previousSheetId === id ? null : state.previousSheetId,
      };
    }),

  setActiveSheetId: (id) =>
    set((state) => {
      if (!state.sheets[id] || state.activeSheetId === id) return state;
      return {
        activeSheetId: id,
        previousSheetId: state.activeSheetId,
      };
    }),

  switchToPreviousSheet: () =>
    set((state) => {
      if (!state.previousSheetId || !state.sheets[state.previousSheetId]) {
        return state;
      }
      return {
        activeSheetId: state.previousSheetId,
        previousSheetId: state.activeSheetId,
      };
    }),

  closeSheet: (id) =>
    set((state) => {
      const sheetOrder = state.sheetOrder.filter((sheetId) => sheetId !== id);
      const sheets = { ...state.sheets };
      const closedIds = [id, ...(sheets[id]?.children ?? [])];
      if (sheets[id]) {
        void invoke("close_dataset", { datasetId: sheets[id].datasetId });
      }
      for (const closedId of closedIds) delete sheets[closedId];
      const plotConfig = { ...state.plotConfig };
      delete plotConfig[id];
      let activeSheetId = state.activeSheetId;
      if (closedIds.includes(activeSheetId)) {
        const closedIndex = state.sheetOrder.indexOf(id);
        activeSheetId = sheetOrder[closedIndex] ?? sheetOrder[closedIndex - 1] ?? null;
      }
      let previousSheetId = state.previousSheetId;
      if (closedIds.includes(previousSheetId) || previousSheetId === activeSheetId) {
        previousSheetId = null;
      }
      return {
        sheets,
        sheetOrder,
        plotConfig,
        activeSheetId,
        previousSheetId,
      };
    }),

  setColumnVisibility: (sheetId, columnVisibility) =>
    set((state) => ({
      sheets: {
        ...state.sheets,
        [sheetId]: { ...state.sheets[sheetId], columnVisibility },
      },
    })),

  moveColumn: (sheetId, sourceColumn, targetColumn, position) =>
    set((state) => {
      const sheet = state.sheets[sheetId];
      if (!sheet || sourceColumn === targetColumn) return state;

      const columns = sheet.columns.filter((column) => column !== sourceColumn);
      const targetIndex = columns.indexOf(targetColumn);
      if (targetIndex === -1) return state;
      columns.splice(
        targetIndex + (position === "after" ? 1 : 0),
        0,
        sourceColumn,
      );

      return {
        sheets: {
          ...state.sheets,
          [sheetId]: { ...sheet, columns },
        },
      };
    }),

  setSorting: async (sheetId, sorting) => {
    const sheet = get().sheets[sheetId];
    if (!sheet) return;
    set((state) => ({
      sheets: {
        ...state.sheets,
        [sheetId]: { ...state.sheets[sheetId], sorting },
      },
    }));
    await invoke("sort_dataset", {
      datasetId: sheet.datasetId,
      sorting: sorting.map((sort) => ({
        ...sort,
        columnType: sheet.columnTypes[sort.id],
      })),
    });
    set((state) => ({
      sheets: state.sheets[sheetId]
        ? {
            ...state.sheets,
            [sheetId]: {
              ...state.sheets[sheetId],
              dataVersion: state.sheets[sheetId].dataVersion + 1,
            },
          }
        : state.sheets,
    }));
  },

  toggleColumnSelection: (sheetId, column) =>
    set((state) => {
      const sheet = state.sheets[sheetId];
      const selectedColumns = sheet.selectedColumns.includes(column)
        ? sheet.selectedColumns.filter((selected) => selected !== column)
        : [...sheet.selectedColumns, column];

      return {
        sheets: {
          ...state.sheets,
          [sheetId]: { ...sheet, selectedColumns },
        },
      };
    }),

  setPlotConfig: (sheetId, config) =>
    set((state) => ({
      plotConfig: { ...state.plotConfig, [sheetId]: config },
    })),

  setColumnType: (sheetId, column, type) =>
    set((state) => {
      const sheet = state.sheets[sheetId];
      return {
        sheets: {
          ...state.sheets,
          [sheetId]: {
            ...sheet,
            columnTypes: { ...sheet.columnTypes, [column]: type },
          },
        },
      };
    }),

  setColumnPrecision: (sheetId, column, precision) =>
    set((state) => {
      const sheet = state.sheets[sheetId];
      return {
        sheets: {
          ...state.sheets,
          [sheetId]: {
            ...sheet,
            columnPrecision: { ...sheet.columnPrecision, [column]: precision },
          },
        },
      };
    }),
}));

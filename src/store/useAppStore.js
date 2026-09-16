import { create } from "zustand";

export const useAppStore = create((set) => ({
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

  sheets: {},
  sheetOrder: [],
  activeSheetId: null,
  plotConfig: {},

  openSheet: (filename, columns, rows, sizeBytes) =>
    set((state) => {
      const id = crypto.randomUUID();
      const columnVisibility = {};
      const columnTypes = {};
      const columnPrecision = {};
      for (const column of columns) {
        columnVisibility[column] = true;
        columnTypes[column] = "string";
        columnPrecision[column] = 2;
      }
      return {
        sheets: {
          ...state.sheets,
          [id]: {
            id,
            filename,
            rows,
            columns,
            columnVisibility,
            columnTypes,
            columnPrecision,
            sorting: null,
            versions: [],
            sizeBytes,
          },
        },
        sheetOrder: [...state.sheetOrder, id],
        activeSheetId: id,
      };
    }),

  setActiveSheetId: (id) => set({ activeSheetId: id }),

  setColumnVisibility: (sheetId, columnVisibility) =>
    set((state) => ({
      sheets: {
        ...state.sheets,
        [sheetId]: { ...state.sheets[sheetId], columnVisibility },
      },
    })),

  setSorting: (sheetId, sorting) =>
    set((state) => ({
      sheets: {
        ...state.sheets,
        [sheetId]: { ...state.sheets[sheetId], sorting },
      },
    })),

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

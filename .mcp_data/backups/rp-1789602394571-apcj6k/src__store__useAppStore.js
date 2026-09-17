// Owns application state for opened CSV sheets, display settings, and plots.
// FEATURE: CSV data workspace
import { create } from "zustand";
import { inferColumnTypes } from "../utils/columnTypes";

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
      const columnTypes = inferColumnTypes(columns, rows);
      const columnPrecision = {};
      for (const column of columns) {
        columnVisibility[column] = true;
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

  closeSheet: (id) =>
    set((state) => {
      const sheetOrder = state.sheetOrder.filter((sheetId) => sheetId !== id);
      const sheets = { ...state.sheets };
      delete sheets[id];
      const plotConfig = { ...state.plotConfig };
      delete plotConfig[id];
      let activeSheetId = state.activeSheetId;
      if (activeSheetId === id) {
        const closedIndex = state.sheetOrder.indexOf(id);
        activeSheetId = sheetOrder[closedIndex] ?? sheetOrder[closedIndex - 1] ?? null;
      }
      return { sheets, sheetOrder, plotConfig, activeSheetId };
    }),

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

// Owns application state for opened CSV sheets, display settings, and plots.
// FEATURE: CSV data workspace
import { create } from "zustand";
import { inferColumnTypes } from "../utils/columnTypes";
import { buildMatcher, findMatches } from "../utils/search";

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
  openSearch: () =>
    set({ searchOpen: true, searchQuery: "", searchActiveIndex: 0 }),
  closeSearch: () => set({ searchOpen: false }),
  setSearchQuery: (query) =>
    set({ searchQuery: query, searchActiveIndex: 0 }),
  setSearchIsRegex: (isRegex) =>
    set({ searchIsRegex: isRegex, searchActiveIndex: 0 }),
  setSearchIsCaseSensitive: (isCaseSensitive) =>
    set({ searchIsCaseSensitive: isCaseSensitive, searchActiveIndex: 0 }),
  setSearchActiveIndex: (index) => set({ searchActiveIndex: index }),

  openSheet: (filename, columns, rows, sizeBytes, path, separator) =>
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
            path: path ?? null,
            separator: separator || ",",
            rows,
            columns,
            columnVisibility,
            columnTypes,
            columnPrecision,
            selectedColumns: [],
            sorting: [],
            versions: [],
            children: [],
            filterOf: null,
            sizeBytes,
          },
        },
        sheetOrder: [...state.sheetOrder, id],
        activeSheetId: id,
        previousSheetId: state.activeSheetId,
      };
    }),

  rescanSheet: (sheetId, separator, columns, rows, sizeBytes) =>
    set((state) => {
      const sheet = state.sheets[sheetId];
      if (!sheet) return state;
      const columnVisibility = {};
      const columnTypes = inferColumnTypes(columns, rows);
      const columnPrecision = {};
      for (const column of columns) {
        columnVisibility[column] = true;
        columnPrecision[column] = 2;
      }

      const sheets = {
        ...state.sheets,
        [sheetId]: {
          ...sheet,
          separator,
          columns,
          rows,
          columnVisibility,
          columnTypes,
          columnPrecision,
          selectedColumns: [],
          sorting: [],
          sizeBytes,
        },
      };

      for (const childId of sheet.children) {
        const child = sheets[childId];
        if (!child) continue;
        const matcher = buildMatcher(
          child.filterOf.pattern,
          child.filterOf.isRegex,
          child.filterOf.isCaseSensitive,
        );
        const matchedRows = matcher
          ? [
              ...new Set(
                findMatches(rows, columns, matcher).map((match) => match.rowIndex),
              ),
            ].map((rowIndex) => rows[rowIndex])
          : [];
        sheets[childId] = {
          ...child,
          columns,
          rows: matchedRows,
          columnVisibility,
          columnTypes,
          columnPrecision,
        };
      }

      return { sheets };
    }),

  createFilteredSheet: (sourceId, pattern, isRegex, isCaseSensitive) =>
    set((state) => {
      const source = state.sheets[sourceId];
      const matcher = buildMatcher(pattern, isRegex, isCaseSensitive);
      if (!source || !matcher) return state;

      const matchedRowIndexes = [
        ...new Set(
          findMatches(source.rows, source.columns, matcher).map(
            (match) => match.rowIndex,
          ),
        ),
      ];
      if (matchedRowIndexes.length === 0) return state;

      const id = crypto.randomUUID();
      const child = {
        id,
        filename: `${source.filename} : ${pattern}`,
        path: null,
        separator: source.separator,
        rows: matchedRowIndexes.map((rowIndex) => source.rows[rowIndex]),
        columns: source.columns,
        columnVisibility: source.columnVisibility,
        columnTypes: source.columnTypes,
        columnPrecision: source.columnPrecision,
        selectedColumns: [],
        sorting: [],
        versions: [],
        children: [],
        filterOf: { sourceId, pattern, isRegex, isCaseSensitive },
        sizeBytes: 0,
      };

      return {
        sheets: {
          ...state.sheets,
          [sourceId]: { ...source, children: [...source.children, id] },
          [id]: child,
        },
        activeSheetId: id,
        previousSheetId: state.activeSheetId,
      };
    }),

  closeFilteredSheet: (id) =>
    set((state) => {
      const child = state.sheets[id];
      if (!child || !child.filterOf) return state;
      const sourceId = child.filterOf.sourceId;
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

  setSorting: (sheetId, sorting) =>
    set((state) => ({
      sheets: {
        ...state.sheets,
        [sheetId]: { ...state.sheets[sheetId], sorting },
      },
    })),

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

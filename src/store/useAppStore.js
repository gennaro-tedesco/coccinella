// Owns application state for opened files, display settings, and plots.
// FEATURE: Data workspace
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import {
  BLANK_VALUE_LABEL,
  DEFAULT_COLUMN_PRECISION,
  DEFAULT_COLUMN_COLOUR_MODE,
  DEFAULT_COPY_QUOTE,
  DEFAULT_FUZZY_FIND_ITEM_LIMIT,
  EXPRESSION_NO_MATCHES_MESSAGE,
} from "../constants";
import { descendantSheetIds } from "../utils/sheets";
import { isDateOnlyFormat } from "../utils/dateFormats";
import { DEFAULT_COLUMN_TYPE_COLOUR_INDEXES } from "../utils/columnTypes";

function expressionConditionLabel(column, condition, precision) {
  if (condition.kind === "number") return `${column} ${condition.expression}`;
  if (condition.kind === "range") {
    return `${column} ${condition.min.toFixed(precision)} – ${condition.max.toFixed(precision)}`;
  }
  if (condition.kind === "date") return `${column} ${condition.direction} ${condition.date}`;
  if (condition.kind === "included") {
    const values = condition.values.map((value) => value || BLANK_VALUE_LABEL);
    return `${column} in ${values.join(", ")}`;
  }
  return `${column} = ${condition.value}`;
}

function closeDatasets(sheets, id) {
  return Promise.all(
    [id, ...descendantSheetIds(sheets, id)].map((sheetId) =>
      invoke("close_dataset", { datasetId: sheets[sheetId].datasetId }),
    ),
  );
}

function renameRecordKey(record, currentName, newName) {
  if (!record || !Object.hasOwn(record, currentName)) return record;
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key === currentName ? newName : key,
      value,
    ]),
  );
}

function derivedSheet(metadata, filename) {
  const columnVisibility = {};
  for (const column of metadata.columns) {
    columnVisibility[column] = true;
  }
  return {
    id: metadata.datasetId,
    kind: "csv",
    filename,
    derived: true,
    path: null,
    datasetId: metadata.datasetId,
    separator: metadata.separator,
    rowCount: metadata.rowCount,
    columns: metadata.columns,
    sourceColumns: metadata.columns,
    columnVisibility,
    columnTypes: metadata.columnTypes,
    columnDateFormats: {},
    columnPrecision: {},
    selectedColumns: [],
    sorting: [],
    children: [],
    filterOf: null,
    sizeBytes: metadata.sizeBytes,
    nullCount: metadata.nullCount,
    dataVersion: 0,
    contentVersion: 0,
    headersModified: false,
  };
}

export const useAppStore = create((set, get) => ({
  mode: "data",
  setMode: (mode) => set({ mode }),

  theme: "darkSolar",
  setTheme: (theme) => set({ theme }),
  previewTheme: null,
  setPreviewTheme: (previewTheme) => set({ previewTheme }),

  fuzzyFindItemLimit: DEFAULT_FUZZY_FIND_ITEM_LIMIT,
  setFuzzyFindItemLimit: (fuzzyFindItemLimit) => set({ fuzzyFindItemLimit }),
  copyWithQuotes: false,
  setCopyWithQuotes: (copyWithQuotes) => set({ copyWithQuotes }),
  copyQuote: DEFAULT_COPY_QUOTE,
  setCopyQuote: (copyQuote) => set({ copyQuote }),
  showRowIndex: false,
  setShowRowIndex: (showRowIndex) => set({ showRowIndex }),
  columnColourMode: DEFAULT_COLUMN_COLOUR_MODE,
  setColumnColourMode: (columnColourMode) => set({ columnColourMode }),
  columnTypeColourIndexes: DEFAULT_COLUMN_TYPE_COLOUR_INDEXES,
  setColumnTypeColour: (type, colourIndex) =>
    set((state) => ({
      columnTypeColourIndexes: {
        ...state.columnTypeColourIndexes,
        [type]: colourIndex,
      },
    })),

  sheetPanelOpen: true,
  toggleSheetPanel: () =>
    set((state) => ({ sheetPanelOpen: !state.sheetPanelOpen })),

  columnPanelOpen: true,
  toggleColumnPanel: () =>
    set((state) => ({ columnPanelOpen: !state.columnPanelOpen })),
  hoveredColumn: null,
  setHoveredColumn: (column) => set({ hoveredColumn: column }),
  copiedColumn: null,
  setCopiedColumn: (copiedColumn) => set({ copiedColumn }),
  scrollPercent: null,
  setScrollPercent: (scrollPercent) => set({ scrollPercent }),
  jsonNavigation: null,
  navigateToJsonKey: (sheetId, schemaPath) =>
    set({ jsonNavigation: { sheetId, schemaPath } }),
  clearJsonNavigation: () => set({ jsonNavigation: null }),

  sheets: {},
  sheetOrder: [],
  activeSheetId: null,
  previousSheetId: null,
  plotConfig: {},
  errorMessage: null,
  showError: (error) =>
    set({ errorMessage: error instanceof Error ? error.message : String(error) }),
  clearError: () => set({ errorMessage: null }),
  fileLoadProgress: null,
  setFileLoadProgress: (fileLoadProgress) => set({ fileLoadProgress }),
  clearFileLoadProgress: (operationId) =>
    set((state) =>
      state.fileLoadProgress?.operationId === operationId
        ? { fileLoadProgress: null }
        : state,
    ),
  cancelFileLoad: async () => {
    const progress = get().fileLoadProgress;
    if (!progress || progress.cancelling) return;
    set({ fileLoadProgress: { ...progress, cancelling: true } });
    try {
      await invoke("cancel_file_load", { operationId: progress.operationId });
      get().clearFileLoadProgress(progress.operationId);
    } catch (error) {
      get().showError(error);
      set((state) =>
        state.fileLoadProgress?.operationId === progress.operationId
          ? {
              fileLoadProgress: {
                ...state.fileLoadProgress,
                cancelling: false,
              },
            }
          : state,
      );
    }
  },

  shortcutsMenuOpen: false,
  openShortcutsMenu: () => set({ shortcutsMenuOpen: true }),
  closeShortcutsMenu: () => set({ shortcutsMenuOpen: false }),

  searchOpen: false,
  searchQuery: "",
  searchNullMode: null,
  searchIsRegex: true,
  searchIsCaseSensitive: false,
  searchActiveIndex: 0,
  searchMatchCount: 0,
  searchError: null,
  activeSearchMatch: null,
  jsonSearchMatches: [],
  searchVersion: 0,
  openSearch: () =>
    set({
      searchOpen: true,
      searchQuery: "",
      searchNullMode: null,
      searchActiveIndex: 0,
      searchError: null,
      jsonSearchMatches: [],
    }),
  closeSearch: () => set({ searchOpen: false }),
  setSearchQuery: (query, nullMode = null) =>
    set({
      searchQuery: query,
      searchNullMode: nullMode,
      searchActiveIndex: 0,
      searchMatchCount: 0,
      activeSearchMatch: null,
      jsonSearchMatches: [],
      searchError: null,
    }),
  setSearchIsRegex: (isRegex) =>
    set({
      searchIsRegex: isRegex,
      searchNullMode: null,
      searchActiveIndex: 0,
      searchMatchCount: 0,
      activeSearchMatch: null,
      jsonSearchMatches: [],
    }),
  setSearchIsCaseSensitive: (isCaseSensitive) =>
    set({
      searchIsCaseSensitive: isCaseSensitive,
      searchActiveIndex: 0,
      searchMatchCount: 0,
      activeSearchMatch: null,
      jsonSearchMatches: [],
    }),
  setSearchActiveIndex: (index) => set({ searchActiveIndex: index }),
  setSearchMatchCount: (searchMatchCount) =>
    set((state) => ({
      searchMatchCount,
      searchVersion: state.searchVersion + 1,
    })),
  setActiveSearchMatch: (activeSearchMatch) => set({ activeSearchMatch }),
  setJsonSearchMatches: (jsonSearchMatches) => set({ jsonSearchMatches }),
  setSearchError: (searchError) => set({ searchError }),

  openSheet: (filename, metadata, path, token) =>
    set((state) => {
      const id = metadata.datasetId;
      const columnVisibility = {};
      for (const column of metadata.columns) {
        columnVisibility[column] = true;
      }
      return {
        sheets: {
          ...state.sheets,
          [id]: {
            id,
            kind: "csv",
            filename,
            path: path ?? null,
            token: token ?? null,
            datasetId: metadata.datasetId,
            separator: metadata.separator,
            rowCount: metadata.rowCount,
            columns: metadata.columns,
            sourceColumns: metadata.columns,
            columnVisibility,
            columnTypes: metadata.columnTypes,
            columnDateFormats: {},
            columnPrecision: {},
            selectedColumns: [],
            sorting: [],
            children: [],
            filterOf: null,
            sizeBytes: metadata.sizeBytes,
            nullCount: metadata.nullCount,
            dataVersion: 0,
            contentVersion: 0,
            headersModified: false,
          },
        },
        sheetOrder: [...state.sheetOrder, id],
        activeSheetId: id,
        previousSheetId: state.activeSheetId,
      };
    }),

  openJson: (filename, id, data, sizeBytes, path, token) =>
    set((state) => ({
      sheets: {
        ...state.sheets,
        [id]: {
          id,
          kind: "json",
          filename,
          path: path ?? null,
          token: token ?? null,
          data,
          sizeBytes,
          children: [],
        },
      },
      sheetOrder: [...state.sheetOrder, id],
      activeSheetId: id,
      previousSheetId: state.activeSheetId,
      mode: "data",
    })),

  reloadSheet: (id, opened) =>
    set((state) => {
      const current = state.sheets[id];
      if (!current) return state;
      const closedIds = [id, ...descendantSheetIds(state.sheets, id)];
      const sheets = { ...state.sheets };
      for (const closedId of closedIds) delete sheets[closedId];
      if (opened.kind === "json") {
        sheets[id] = {
          id,
          kind: "json",
          filename: opened.filename,
          path: opened.path,
          token: current.token,
          data: opened.data,
          sizeBytes: opened.sizeBytes,
          children: [],
        };
      } else {
        const metadata = opened.metadata;
        sheets[id] = {
          id,
          kind: "csv",
          filename: opened.filename,
          path: opened.path,
          token: current.token,
          datasetId: metadata.datasetId,
          separator: metadata.separator,
          rowCount: metadata.rowCount,
          columns: metadata.columns,
          sourceColumns: metadata.columns,
          columnVisibility: Object.fromEntries(
            metadata.columns.map((column) => [column, true]),
          ),
          columnTypes: metadata.columnTypes,
          columnDateFormats: {},
          columnPrecision: {},
          selectedColumns: [],
          sorting: [],
          children: [],
          filterOf: null,
          sizeBytes: metadata.sizeBytes,
          nullCount: metadata.nullCount,
          dataVersion: 0,
          contentVersion: 0,
          headersModified: false,
        };
      }
      const plotConfig = { ...state.plotConfig };
      for (const closedId of closedIds) delete plotConfig[closedId];
      const wasActive = closedIds.includes(state.activeSheetId);
      return {
        sheets,
        plotConfig,
        activeSheetId: wasActive ? id : state.activeSheetId,
        previousSheetId: closedIds.includes(state.previousSheetId)
          ? null
          : state.previousSheetId,
        ...(wasActive
          ? {
              mode: "data",
              hoveredColumn: null,
              copiedColumn: null,
              scrollPercent: null,
              jsonNavigation: null,
              searchOpen: false,
              searchQuery: "",
              searchNullMode: null,
              searchActiveIndex: 0,
              searchMatchCount: 0,
              activeSearchMatch: null,
              jsonSearchMatches: [],
              searchError: null,
            }
          : {}),
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
        sheets[metadata.datasetId] = {
          ...existing,
          separator,
          rowCount: metadata.rowCount,
          columns: metadata.columns,
          sourceColumns: metadata.columns,
          columnVisibility,
          columnTypes: metadata.columnTypes,
          columnDateFormats: {},
          columnPrecision: {},
          selectedColumns:
            metadata.datasetId === sheetId ? [] : existing.selectedColumns,
          sorting: existing.sorting,
          sizeBytes: metadata.sizeBytes,
          nullCount: metadata.nullCount,
          dataVersion: existing.dataVersion + 1,
          contentVersion: existing.contentVersion + 1,
        };
      }

      return { sheets };
    }),

  renameSheet: (id, name) =>
    set((state) => {
      const sheet = state.sheets[id];
      const trimmed = name.trim();
      if (!sheet || !trimmed) return state;
      return {
        sheets: {
          ...state.sheets,
          [id]: { ...sheet, displayName: trimmed },
        },
      };
    }),

  createFilteredSheet: async (sourceId, pattern, isRegex, isCaseSensitive, nonEmpty = null) => {
    const source = get().sheets[sourceId];
    if (!source) return;
    let metadata;
    try {
      metadata = await invoke("create_filtered_dataset", {
        sourceId: source.datasetId,
        pattern,
        isRegex,
        isCaseSensitive,
        columns: source.selectedColumns,
        nonEmpty,
      });
    } catch (error) {
      get().showError(error);
      return;
    }
    if (!metadata) return;
    set((state) => {
      const currentSource = state.sheets[sourceId];
      if (!currentSource) return state;
      const id = metadata.datasetId;
      const nullFilterName = nonEmpty === null
        ? undefined
        : `${nonEmpty ? "non-empty" : "empty"}-${source.filename}`;
      const child = {
        id,
        filename: nullFilterName ?? `${source.filename} : ${pattern}`,
        displayName: nullFilterName,
        path: null,
        datasetId: metadata.datasetId,
        separator: metadata.separator,
        rowCount: metadata.rowCount,
        columns: metadata.columns,
        sourceColumns: metadata.columns,
        columnVisibility: { ...source.columnVisibility },
        columnTypes: metadata.columnTypes,
        columnDateFormats: { ...source.columnDateFormats },
        columnPrecision: { ...source.columnPrecision },
        selectedColumns: [],
        sorting: [],
        children: [],
        filterOf: {
          sourceId,
          pattern,
          isRegex,
          isCaseSensitive,
          columns: source.selectedColumns,
          nonEmpty,
        },
        sizeBytes: metadata.sizeBytes,
        nullCount: metadata.nullCount,
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
    if (nonEmpty !== null && get().activeSheetId === metadata.datasetId) {
      get().setSearchQuery("");
    }
  },

  createRowRangeSheet: async (sourceId, start, end) => {
    const source = get().sheets[sourceId];
    if (!source) return;
    let metadata;
    try {
      metadata = await invoke("create_row_range_dataset", {
        sourceId: source.datasetId,
        start,
        end,
      });
    } catch (error) {
      if (get().sheets[sourceId]) get().showError(error);
      return;
    }
    let attached = false;
    set((state) => {
      const currentSource = state.sheets[sourceId];
      if (!currentSource) return state;
      attached = true;
      const id = metadata.datasetId;
      const label = `Rows ${start + 1}-${end + 1}`;
      const child = {
        id,
        filename: `${currentSource.filename} : ${label}`,
        path: null,
        datasetId: metadata.datasetId,
        separator: metadata.separator,
        rowCount: metadata.rowCount,
        columns: metadata.columns,
        sourceColumns: metadata.columns,
        columnVisibility: { ...currentSource.columnVisibility },
        columnTypes: metadata.columnTypes,
        columnDateFormats: { ...currentSource.columnDateFormats },
        columnPrecision: { ...currentSource.columnPrecision },
        selectedColumns: [],
        sorting: [],
        children: [],
        filterOf: { sourceId, pattern: label, start, end },
        sizeBytes: metadata.sizeBytes,
        nullCount: metadata.nullCount,
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
    if (!attached) {
      try {
        await invoke("close_dataset", { datasetId: metadata.datasetId });
      } catch (error) {
        get().showError(error);
      }
    }
  },

  expressionConditionMatches: async (sourceId, column, condition) => {
    const source = get().sheets[sourceId];
    if (!source) return false;
    return invoke("expression_condition_matches", {
      sourceId: source.datasetId,
      column,
      condition,
    });
  },

  createExpressionFilteredSheet: async (sourceId, column, condition) => {
    const source = get().sheets[sourceId];
    if (!source) return false;
    let metadata;
    try {
      metadata = await invoke("create_expression_filtered_dataset", {
        sourceId: source.datasetId,
        column,
        condition,
      });
    } catch (error) {
      get().showError(error);
      return false;
    }
    if (!metadata) {
      get().showError(EXPRESSION_NO_MATCHES_MESSAGE);
      return false;
    }
    set((state) => {
      const currentSource = state.sheets[sourceId];
      if (!currentSource) return state;
      const id = metadata.datasetId;
      const label = expressionConditionLabel(
        column,
        condition,
        currentSource.columnPrecision[column] ?? DEFAULT_COLUMN_PRECISION,
      );
      const child = {
        id,
        filename: `${source.filename} : ${label}`,
        path: null,
        datasetId: metadata.datasetId,
        separator: metadata.separator,
        rowCount: metadata.rowCount,
        columns: metadata.columns,
        sourceColumns: metadata.columns,
        columnVisibility: { ...source.columnVisibility },
        columnTypes: metadata.columnTypes,
        columnDateFormats: { ...source.columnDateFormats },
        columnPrecision: { ...source.columnPrecision },
        selectedColumns: [],
        sorting: [],
        children: [],
        filterOf: {
          sourceId,
          pattern: label,
        },
        sizeBytes: metadata.sizeBytes,
        nullCount: metadata.nullCount,
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
    return true;
  },

  createJoinedSheet: async (leftId, rightId, columns, joinType) => {
    const { sheets } = get();
    const left = sheets[leftId];
    const right = sheets[rightId];
    if (!left || !right) return false;
    let metadata;
    try {
      metadata = await invoke("create_joined_dataset", {
        leftId: left.datasetId,
        rightId: right.datasetId,
        columns,
        joinType,
      });
    } catch (error) {
      get().showError(error);
      return false;
    }
    set((state) => {
      const id = metadata.datasetId;
      return {
        sheets: {
          ...state.sheets,
          [id]: derivedSheet(metadata, `${left.filename} + ${right.filename}`),
        },
        sheetOrder: [...state.sheetOrder, id],
        activeSheetId: id,
        previousSheetId: state.activeSheetId,
      };
    });
    return true;
  },

  createAppendedSheet: async (ids) => {
    const sheets = get().sheets;
    const selected = ids.map((id) => sheets[id]).filter(Boolean);
    if (selected.length !== ids.length) return false;
    let metadata;
    try {
      metadata = await invoke("create_appended_dataset", {
        datasetIds: selected.map((sheet) => sheet.datasetId),
      });
    } catch (error) {
      get().showError(error);
      return false;
    }
    set((state) => {
      const id = metadata.datasetId;
      return {
        sheets: {
          ...state.sheets,
          [id]: derivedSheet(
            metadata,
            `Append: ${selected.map((sheet) => sheet.filename).join(", ")}`,
          ),
        },
        sheetOrder: [...state.sheetOrder, id],
        activeSheetId: id,
        previousSheetId: state.activeSheetId,
      };
    });
    return true;
  },

  createAggregatedSheet: async (sourceId, aggregations, groupBy, pivotTable) => {
    const source = get().sheets[sourceId];
    if (!source) return false;
    const dateOnlyGroupBy = groupBy.filter(
      (column) => source.columnTypes[column] === "date"
        && isDateOnlyFormat(source.columnDateFormats[column]),
    );
    let metadata;
    try {
      metadata = await invoke("create_aggregated_dataset", {
        datasetId: source.datasetId,
        aggregations,
        groupBy,
        pivotTable,
        dateOnlyGroupBy,
      });
    } catch (error) {
      get().showError(error);
      return false;
    }
    set((state) => {
      const id = metadata.datasetId;
      const [rowDimension, columnDimension] = groupBy;
      const measure = aggregations[0];
      return {
        sheets: {
          ...state.sheets,
          [id]: {
            ...derivedSheet(
              metadata,
              `${pivotTable ? "Pivot" : "Aggregate"}: ${source.filename}`,
            ),
            columnDateFormats: Object.fromEntries(
              groupBy
                .filter((column) => source.columnDateFormats[column])
                .map((column) => [column, source.columnDateFormats[column]]),
            ),
            pivotTable,
            pivotDimensions: pivotTable ? [rowDimension] : [],
            pivotRowDimension: pivotTable ? rowDimension : null,
            pivotColumnDimension: pivotTable ? columnDimension : null,
            pivotMeasureLabel: pivotTable
              ? `${measure.function.replace(/_/g, " ")} of ${measure.column}`
              : null,
          },
        },
        sheetOrder: [...state.sheetOrder, id],
        activeSheetId: id,
        previousSheetId: state.activeSheetId,
      };
    });
    return true;
  },

  createColumnSheet: async (sourceId, name, expression) => {
    const source = get().sheets[sourceId];
    if (!source) return false;
    let metadata;
    try {
      metadata = await invoke("create_column_dataset", {
        datasetId: source.datasetId,
        name,
        expression,
        numberColumns: source.columns.filter((column) => source.columnTypes[column] === "number"),
      });
    } catch (error) {
      get().showError(error);
      return false;
    }
    set((state) => {
      const id = metadata.datasetId;
      const sheet = derivedSheet(metadata, `${source.filename} + ${name.trim()}`);
      const parentId = source.filterOf?.sourceId;
      const parent = parentId ? state.sheets[parentId] : null;
      if (!parent) {
        return {
          sheets: { ...state.sheets, [id]: sheet },
          sheetOrder: [...state.sheetOrder, id],
          activeSheetId: id,
          previousSheetId: state.activeSheetId,
        };
      }
      const children = [...parent.children];
      children.splice(children.indexOf(sourceId) + 1, 0, id);
      return {
        sheets: {
          ...state.sheets,
          [parentId]: { ...parent, children },
          [id]: {
            ...sheet,
            filterOf: {
              sourceId: parentId,
              pattern: `${source.displayName ?? source.filterOf.pattern} + ${name.trim()}`,
            },
          },
        },
        activeSheetId: id,
        previousSheetId: state.activeSheetId,
      };
    });
    return true;
  },

  closeFilteredSheet: async (id) => {
    const child = get().sheets[id];
    if (!child?.filterOf) return;
    try {
      await closeDatasets(get().sheets, id);
    } catch (error) {
      get().showError(error);
      return;
    }
    set((state) => {
      const child = state.sheets[id];
      if (!child || !child.filterOf) return state;
      const sourceId = child.filterOf.sourceId;
      const source = state.sheets[sourceId];
      const sheets = { ...state.sheets };
      const plotConfig = { ...state.plotConfig };
      const closedIds = [id, ...descendantSheetIds(sheets, id)];
      for (const closedId of closedIds) {
        delete sheets[closedId];
        delete plotConfig[closedId];
      }
      if (source) {
        sheets[sourceId] = {
          ...source,
          children: source.children.filter((childId) => childId !== id),
        };
      }
      return {
        sheets,
        plotConfig,
        activeSheetId:
          closedIds.includes(state.activeSheetId) ? sourceId : state.activeSheetId,
        previousSheetId:
          closedIds.includes(state.previousSheetId) ? null : state.previousSheetId,
      };
    });
  },

  setActiveSheetId: (id) =>
    set((state) => {
      if (!state.sheets[id] || state.activeSheetId === id) return state;
      return {
        activeSheetId: id,
        previousSheetId: state.activeSheetId,
        mode: state.sheets[id].kind === "json" ? "data" : state.mode,
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
        mode:
          state.sheets[state.previousSheetId].kind === "json"
            ? "data"
            : state.mode,
      };
    }),

  closeSheet: async (id) => {
    const sheet = get().sheets[id];
    if (!sheet) return;
    if (sheet.kind !== "json") {
      try {
        await closeDatasets(get().sheets, id);
      } catch (error) {
        get().showError(error);
        return;
      }
    }
    set((state) => {
      const sheetOrder = state.sheetOrder.filter((sheetId) => sheetId !== id);
      const sheets = { ...state.sheets };
      const closedIds = [id, ...descendantSheetIds(sheets, id)];
      for (const closedId of closedIds) delete sheets[closedId];
      const plotConfig = { ...state.plotConfig };
      for (const closedId of closedIds) delete plotConfig[closedId];
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
        mode:
          activeSheetId && sheets[activeSheetId]?.kind === "json"
            ? "data"
            : state.mode,
      };
    });
  },

  setColumnVisibility: (sheetId, columnVisibility) =>
    set((state) => ({
      sheets: {
        ...state.sheets,
        [sheetId]: { ...state.sheets[sheetId], columnVisibility },
      },
    })),

  setColumnWidth: (sheetId, column, width) =>
    set((state) => {
      const sheet = state.sheets[sheetId];
      if (!sheet) return state;
      return {
        sheets: {
          ...state.sheets,
          [sheetId]: {
            ...sheet,
            columnWidths: { ...sheet.columnWidths, [column]: width },
          },
        },
      };
    }),

  resetColumnWidth: (sheetId, column) =>
    set((state) => {
      const sheet = state.sheets[sheetId];
      if (!sheet) return state;
      const { [column]: _removed, ...columnWidths } = sheet.columnWidths ?? {};
      return {
        sheets: {
          ...state.sheets,
          [sheetId]: { ...sheet, columnWidths },
        },
      };
    }),

  renameColumn: async (sheetId, currentName, newName) => {
    const trimmedName = newName.trim();
    if (!trimmedName || trimmedName === currentName) return false;
    let metadataList;
    try {
      metadataList = await invoke("rename_column", {
        datasetId: get().sheets[sheetId]?.datasetId,
        currentName,
        newName: trimmedName,
      });
    } catch (error) {
      get().showError(error);
      return false;
    }
    set((state) => {
      const sheets = { ...state.sheets };
      const plotConfig = { ...state.plotConfig };
      for (const metadata of metadataList) {
        const sheet = sheets[metadata.datasetId];
        if (!sheet) continue;
        sheets[metadata.datasetId] = {
          ...sheet,
          columns: sheet.columns.map((column) =>
            column === currentName ? trimmedName : column,
          ),
          sourceColumns: sheet.sourceColumns.map((column) =>
            column === currentName ? trimmedName : column,
          ),
          columnVisibility: renameRecordKey(
            sheet.columnVisibility,
            currentName,
            trimmedName,
          ),
          columnTypes: renameRecordKey(
            sheet.columnTypes,
            currentName,
            trimmedName,
          ),
          columnDateFormats: renameRecordKey(
            sheet.columnDateFormats,
            currentName,
            trimmedName,
          ),
          columnPrecision: renameRecordKey(
            sheet.columnPrecision,
            currentName,
            trimmedName,
          ),
          columnWidths: renameRecordKey(
            sheet.columnWidths,
            currentName,
            trimmedName,
          ),
          selectedColumns: sheet.selectedColumns.map((column) =>
            column === currentName ? trimmedName : column,
          ),
          sorting: sheet.sorting.map((sort) => ({
            ...sort,
            id: sort.id === currentName ? trimmedName : sort.id,
          })),
          pivotDimensions: sheet.pivotDimensions?.map((column) =>
            column === currentName ? trimmedName : column,
          ),
          pivotRowDimension:
            sheet.pivotRowDimension === currentName
              ? trimmedName
              : sheet.pivotRowDimension,
          pivotColumnDimension:
            sheet.pivotColumnDimension === currentName
              ? trimmedName
              : sheet.pivotColumnDimension,
          dataVersion: sheet.dataVersion + 1,
          contentVersion: sheet.contentVersion + 1,
          headersModified: true,
        };
        delete plotConfig[metadata.datasetId];
      }
      return {
        sheets,
        plotConfig,
        hoveredColumn:
          state.hoveredColumn === currentName
            ? trimmedName
            : state.hoveredColumn,
        copiedColumn:
          state.copiedColumn?.column === currentName
            ? { ...state.copiedColumn, column: trimmedName }
            : state.copiedColumn,
        activeSearchMatch: null,
        searchMatchCount: 0,
        searchVersion: state.searchVersion + 1,
      };
    });
    return true;
  },

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

  moveSheet: (sourceId, targetId, position) =>
    set((state) => {
      if (sourceId === targetId) return state;

      const sheetOrder = state.sheetOrder.filter((id) => id !== sourceId);
      const targetIndex = sheetOrder.indexOf(targetId);
      if (targetIndex === -1) return state;
      sheetOrder.splice(
        targetIndex + (position === "after" ? 1 : 0),
        0,
        sourceId,
      );

      return { sheetOrder };
    }),

  setSorting: async (sheetId, sorting) => {
    const sheet = get().sheets[sheetId];
    if (!sheet) return;
    let applied;
    try {
      applied = await invoke("sort_dataset", {
        datasetId: sheet.datasetId,
        sorting: sorting.map((sort) => ({
          ...sort,
          columnType: sheet.columnTypes[sort.id],
        })),
      });
    } catch (error) {
      get().showError(error);
      return;
    }
    if (!applied) return;
    set((state) => ({
      sheets: state.sheets[sheetId]
        ? {
            ...state.sheets,
            [sheetId]: {
              ...state.sheets[sheetId],
              sorting,
              dataVersion: state.sheets[sheetId].dataVersion + 1,
            },
          }
        : state.sheets,
    }));
  },

  saveSheetView: async (sheetId) => {
    const sheet = get().sheets[sheetId];
    if (!sheet) return false;
    const filename = sheet.filename.replace(/[<>:"/\\|?*]/g, "-");
    const basename = filename.replace(/\.csv$/i, "");
    try {
      return await invoke("save_csv_file_dialog", {
        datasetId: sheet.datasetId,
        defaultName: `${basename}-view.csv`,
        columns: sheet.columns.filter(
          (column) => sheet.columnVisibility[column] !== false,
        ),
      });
    } catch (error) {
      get().showError(error);
      return false;
    }
  },

  reloadSheetView: async (sheetId) => {
    const sheet = get().sheets[sheetId];
    if (!sheet) return false;
    if (sheet.sorting.length > 0) {
      try {
        const applied = await invoke("sort_dataset", {
          datasetId: sheet.datasetId,
          sorting: [],
        });
        if (!applied) return false;
      } catch (error) {
        get().showError(error);
        return false;
      }
    }
    set((state) => {
      const current = state.sheets[sheetId];
      if (!current) return state;
      return {
        sheets: {
          ...state.sheets,
          [sheetId]: {
            ...current,
            columnVisibility: Object.fromEntries(
              current.columns.map((column) => [column, true]),
            ),
            sorting: [],
            dataVersion:
              sheet.sorting.length > 0
                ? current.dataVersion + 1
                : current.dataVersion,
          },
        },
      };
    });
    return true;
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

  setColumnDateFormat: (sheetId, column, format) =>
    set((state) => {
      const sheet = state.sheets[sheetId];
      return {
        sheets: {
          ...state.sheets,
          [sheetId]: {
            ...sheet,
            columnDateFormats: { ...sheet.columnDateFormats, [column]: format },
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

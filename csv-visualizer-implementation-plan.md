# CSV Visualizer — Implementation Plan

## 1. Overview

A cross-platform desktop app (macOS primary target, must also build for Windows/Linux) that lets a
user open one or more CSV files and:

- View each CSV as an interactive table (filter/sort/show-hide columns)
- Build interactive charts from the loaded data

The app has two top-level modes, **Data** and **Plot**, toggled from the top bar.

## 2. Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| Desktop shell | **Tauri v2** (Rust) | Native window, file-system access, packaging. Small binaries vs Electron. |
| Frontend framework | **React 18**, plain **JavaScript** | Explicitly **no TypeScript** — this is a hard constraint. |
| Bundler | **Vite** | Standard pairing with Tauri + React. |
| App state | **Zustand** | Cross-panel state (open sheets, active sheet, mode) shared across tabs/tree/panels without prop-drilling or Context re-render issues. |
| CSV parsing | **PapaParse** | Streaming, type inference, malformed-row handling. |
| Table | **TanStack Table** (headless) | Provides column visibility state and column sorting natively — do not hand-roll these. |
| Charts | **Plotly.js** | Interactive (zoom/pan/hover) charting on arbitrary tabular data; supports many chart types out of the box. |
| Packaging | **GitHub Actions**, matrix build (`macos-latest`, `windows-latest`, `ubuntu-latest`) | A native macOS `.app`/`.dmg` cannot be produced by cross-compiling from Linux — it must be built on a macOS runner or machine. |

## 3. Functional Requirements

### 3.1 Layout

```
┌──────────────────────────────────────────────────────────────┐
│ [File ▾: Open / Browse / Search]         [ Data | Plot ]     │  ← top bar
├───────────┬────────────────────────────────────┬─────────────┤
│  Sheet    │  [Tab: file1.csv] [Tab: file2.csv]  │   Column    │
│  panel    │ ┌────────────────────────────────┐  │   panel     │
│ (left,    │ │                                  │  │ (right,     │
│  tree)    │ │  Data mode: table                │  │  Data mode  │
│           │ │  Plot mode: chart builder         │  │  only)      │
└───────────┴────────────────────────────────────┴─────────────┘
```

- Three-pane layout: left "Sheet panel", center content area, right "Column panel".
- The **Sheet panel** (left) is visible in both Data and Plot modes — the user still needs to pick
  which file to work on in either mode.
- The **Column panel** (right) is **Data-mode only**. In Plot mode it is replaced by a chart
  configuration panel (column pickers + chart type selector).
- The center content area swaps between the data table (Data mode) and the chart builder (Plot mode).

### 3.2 Sheet panel (left)

- Tree view listing every currently open CSV file.
- Each file node has a nested sub-tree of "versions" of that file.
  - **Versions are not yet specified.** Build the tree structure so a file node can contain child
    "version" nodes, but do not implement any versioning logic, diffing, or version-creation UI.
    This is an intentional stub, pending further spec from the product owner.
- Clicking a file node in the tree sets it as the active sheet (see §3.4 for sync behavior).

### 3.3 Tabs

- Every open CSV file is represented by a tab above the center content area.
- Tabs can be clicked to switch which file is active/displayed.

### 3.4 Tab ↔ Sheet panel sync (two-way)

- Selecting a tab sets that file as the active sheet, which also highlights the corresponding node
  in the Sheet panel tree.
- Selecting a file node in the Sheet panel tree does the reverse: makes that file's tab active.
- There is exactly one "active sheet" concept driving both UI surfaces — they must never disagree.

### 3.5 Data table (center, Data mode)

- Renders the active sheet's rows/columns.
- Column headers are clickable to cycle sort state: ascending → descending → unsorted.
- Only columns currently marked "visible" (see Column panel) are rendered.
- Sorting must be type-aware (see §3.6) — e.g. a column typed as Number sorts `9 < 10`, not
  lexically (`"10" < "9"`).

### 3.6 Column panel (right, Data-mode only)

- Lists every column of the active sheet.
- Each row: a visibility toggle (show/hide that column in the table) and a data-type selector.
- Default type options: **String, Number, Date, Boolean, Category** — this list is a reasonable
  default; confirm with the product owner if a different type set is required before treating it
  as final.
- Changing a column's type changes how that column sorts in the table.

### 3.7 Mode switch (Data / Plot)

- A single top-level toggle in the top bar switches the whole app between "Data" and "Plot" modes.
- Switching modes swaps the center content and the right-hand panel as described in §3.1.

### 3.8 Plot mode (center, Plot-mode)

- Chart builder: column picker(s) + chart type selector, rendering a Plotly.js chart of the active
  sheet's data.
- Chart must update reactively as column/type selections change.

### 3.9 Top bar dropdown menu

- A dropdown with three items: **Open, Browse, Search**.
- **Open**: triggers the native file picker (via Tauri's dialog API), loads the selected CSV
  (PapaParse), creates a new tab + Sheet panel node for it, and makes it the active sheet.
- **Browse** and **Search**: render as menu items but are **inert placeholders** for now — no
  behavior implemented, no dialogs, no side effects. Their eventual behavior is undefined pending
  further spec.

## 4. State Model (Zustand store)

```js
{
  sheets: {
    [sheetId]: {
      id: string,
      filename: string,
      rows: object[],            // parsed CSV rows
      columns: string[],         // column names
      columnVisibility: { [columnName]: boolean },
      columnTypes: { [columnName]: 'string' | 'number' | 'date' | 'boolean' | 'category' },
      sorting: { columnName: string, direction: 'asc' | 'desc' } | null,
      versions: [],              // stub, unused for now
    }
  },
  sheetOrder: string[],          // tab order
  activeSheetId: string | null,  // drives tab highlight AND tree highlight AND center content
  mode: 'data' | 'plot',
  plotConfig: {
    [sheetId]: { xColumn: string, yColumn: string, chartType: string }
  }
}
```

## 5. Project Structure

```
csv-visualizer/
├── src-tauri/
│   ├── src/main.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── store/
│   │   └── useAppStore.js       # Zustand store per §4
│   ├── components/
│   │   ├── TopBar.jsx           # File dropdown (Open/Browse[stub]/Search[stub]) + Data|Plot switch
│   │   ├── SheetPanel.jsx       # left tree: files → versions (stub)
│   │   ├── FileTabs.jsx         # tab bar, synced to SheetPanel selection (§3.4)
│   │   ├── DataTable.jsx        # TanStack Table: sort, column visibility
│   │   ├── ColumnPanel.jsx      # right panel: visibility toggle + type dropdown
│   │   └── ChartBuilder.jsx     # Plot mode: column pickers + Plotly
│   └── utils/
│       ├── csv.js               # PapaParse wrapper
│       └── columnTypes.js       # type-aware sort comparators
├── package.json
├── vite.config.js
└── .github/workflows/release.yml
```

## 6. Component Responsibilities

- **TopBar.jsx** — renders the Open/Browse/Search dropdown and the Data|Plot toggle. Only "Open"
  is wired to logic; Browse/Search are disabled or no-op.
- **SheetPanel.jsx** — renders `sheetOrder` as a tree; each node's "versions" child is an empty,
  always-collapsed/empty stub. Clicking a node sets `activeSheetId`.
- **FileTabs.jsx** — renders `sheetOrder` as tabs; clicking a tab sets `activeSheetId`. Must read
  the same `activeSheetId` the SheetPanel writes to, and vice versa.
- **DataTable.jsx** — TanStack Table instance bound to the active sheet's `rows`/`columns`, using
  `columnVisibility` and a custom sort function per `columnTypes`.
- **ColumnPanel.jsx** — reads/writes `columnVisibility` and `columnTypes` for the active sheet.
- **ChartBuilder.jsx** — reads/writes `plotConfig[activeSheetId]`, renders a Plotly chart.

## 7. Phased Implementation Plan

```
Phase 1 — Project scaffold
  Set up Tauri v2 + React (JS, no TS) + Vite + Zustand.
  Verify: `npm run tauri dev` opens a native window; hot reload works;
          `cargo check` in src-tauri/ passes.

Phase 2 — App shell
  Build the 3-pane layout + TopBar (dropdown with Open wired, Browse/Search as
  inert placeholders) + Data|Plot mode toggle.
  Verify: layout renders correctly; toggling mode swaps center/right panel
          content (even with placeholder/empty content at this stage).

Phase 3 — File open + tabs + sheet panel sync
  Wire "Open" to Tauri's file dialog + PapaParse. Opening a file creates a
  sheet entry, a tab, and a Sheet panel tree node, and sets it active.
  Verify: opening two files produces two tabs and two tree nodes; clicking
          either a tab or its corresponding tree node updates activeSheetId
          and both UI surfaces reflect the same active selection.

Phase 4 — Data table: sorting + column visibility
  Implement DataTable.jsx with TanStack Table; wire ColumnPanel.jsx visibility
  toggles to columnVisibility; wire header clicks to cycle sort state.
  Verify: toggling a column off in the panel removes it from the table and
          vice versa; clicking a header cycles asc → desc → unsorted.

Phase 5 — Column data types
  Implement the per-column type selector in ColumnPanel.jsx and type-aware
  sort comparators in utils/columnTypes.js.
  Verify: a numeric column typed as Number sorts 9 before 10; the same column
          left as String sorts "10" before "9" (demonstrating the comparator
          actually branches on type).

Phase 6 — Plot mode
  Implement ChartBuilder.jsx: column pickers, chart type selector, Plotly render,
  reading/writing plotConfig for the active sheet.
  Verify: switching to Plot mode replaces ColumnPanel with the chart config
          panel; changing column/type selections updates the rendered chart.

Phase 7 — Packaging
  Add .github/workflows/release.yml: matrix build across macos-latest,
  windows-latest, ubuntu-latest, producing installable bundles.
  Verify: CI run produces a downloadable artifact per OS.
```

## 8. Known Constraints / Open Items

- **Versions**: the Sheet panel's per-file "versions" concept is unspecified. Structure only —
  no logic. Do not infer behavior for this; wait for explicit spec.
- **Browse / Search**: dropdown items with no defined behavior yet. Render as inert placeholders.
- **macOS build**: this plan assumes the executing environment can run `npm install` and
  `cargo build`/`cargo tauri build` natively on each target OS (directly or via CI). A Linux-only
  environment cannot produce a macOS `.app`/`.dmg`.
- **Column type list** (String/Number/Date/Boolean/Category): a reasonable default, not yet
  confirmed by the product owner — flag if this needs to change before finalizing ColumnPanel.jsx.

## 9. Explicit Assumptions

- Zustand was chosen over plain React Context for cross-panel state, given the number of
  components (tabs, tree, table, two side panels) that need to read/write shared state.
- The Sheet panel remains mounted and visible in both Data and Plot modes.
- "Open" uses Tauri's native file dialog (not an HTML `<input type="file">`), consistent with a
  native desktop app.

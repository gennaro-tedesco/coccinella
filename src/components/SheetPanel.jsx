import { ChevronLeft, ChevronRight, RotateCcw, Save, X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { useDragReorder } from "../hooks/useDragReorder";
import { ICON_SIZE_DEFAULT, ICON_SIZE_SMALL } from "../constants";

function isViewModified(sheet) {
  return (
    sheet.sorting.length > 0 ||
    sheet.columns.some((column) => sheet.columnVisibility[column] === false)
  );
}

function FilteredSheetNode({
  id,
  sheets,
  activeSheetId,
  setActiveSheetId,
  closeFilteredSheet,
  saveSheetView,
  reloadSheetView,
}) {
  const sheet = sheets[id];
  if (!sheet) return null;
  const viewModified = isViewModified(sheet);
  return (
    <li>
      <div className={"sheet-node-row" + (id === activeSheetId ? " active" : "")}>
        <span className="sheet-tree-branch" aria-hidden="true" />
        <div className="sheet-child-content">
          <button type="button" className="sheet-node" onClick={() => setActiveSheetId(id)}>
            {sheet.filterOf.pattern}
          </button>
          <button
            type="button"
            className={`sheet-node-action${viewModified ? " view-change-action" : ""}`}
            aria-label="Save sheet view as new file"
            title="Save sheet view as new file"
            onClick={(event) => {
              event.stopPropagation();
              void saveSheetView(id);
            }}
          >
            <Save size={ICON_SIZE_SMALL} />
          </button>
          {viewModified && (
            <button
              type="button"
              className="sheet-node-action view-change-action"
              aria-label="Reload original sheet view"
              title="Reload original sheet view"
              onClick={(event) => {
                event.stopPropagation();
                void reloadSheetView(id);
              }}
            >
              <RotateCcw size={ICON_SIZE_SMALL} />
            </button>
          )}
          <button
            type="button"
            className="sheet-node-action"
            aria-label="Close filtered sheet"
            onClick={(event) => {
              event.stopPropagation();
              void closeFilteredSheet(id);
            }}
          >
            <X size={ICON_SIZE_SMALL} />
          </button>
        </div>
      </div>
      {sheet.children.length > 0 && (
        <ul className="sheet-children">
          {sheet.children.map((childId) => (
            <FilteredSheetNode
              key={childId}
              id={childId}
              sheets={sheets}
              activeSheetId={activeSheetId}
              setActiveSheetId={setActiveSheetId}
              closeFilteredSheet={closeFilteredSheet}
              saveSheetView={saveSheetView}
              reloadSheetView={reloadSheetView}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function SheetPanel() {
  const sheetOrder = useAppStore((state) => state.sheetOrder);
  const sheets = useAppStore((state) => state.sheets);
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const setActiveSheetId = useAppStore((state) => state.setActiveSheetId);
  const closeSheet = useAppStore((state) => state.closeSheet);
  const closeFilteredSheet = useAppStore((state) => state.closeFilteredSheet);
  const sheetPanelOpen = useAppStore((state) => state.sheetPanelOpen);
  const toggleSheetPanel = useAppStore((state) => state.toggleSheetPanel);
  const saveSheetView = useAppStore((state) => state.saveSheetView);
  const reloadSheetView = useAppStore((state) => state.reloadSheetView);
  const moveSheet = useAppStore((state) => state.moveSheet);

  const {
    draggedItem: draggedSheetId,
    dropTarget,
    shouldIgnoreClick,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  } = useDragReorder({
    selector: "[data-sheet-tab]",
    axis: "y",
    onMove: moveSheet,
  });

  if (!sheetPanelOpen) {
    return (
      <div className="sheet-panel collapsed">
        <button
          type="button"
          className="panel-toggle"
          aria-label="Open sheets panel"
          onClick={toggleSheetPanel}
        >
          <ChevronRight size={ICON_SIZE_DEFAULT} />
        </button>
      </div>
    );
  }

  return (
    <div className="sheet-panel">
      {sheetOrder.length === 0 && (
        <div className="panel-empty">No files open</div>
      )}
      <ul className="sheet-tree">
        {sheetOrder.map((id) => {
          const sheet = sheets[id];
          const viewModified = isViewModified(sheet);
          return (
            <li key={id}>
              <div
                data-sheet-tab
                data-item={id}
                className={
                  "sheet-node-row" +
                  (id === activeSheetId ? " active" : "") +
                  (draggedSheetId === id ? " dragging" : "") +
                  (dropTarget?.item === id ? ` drag-over-${dropTarget.position}` : "")
                }
              >
                <button
                  type="button"
                  className="sheet-node"
                  onPointerDown={handlePointerDown(id)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerCancel}
                  onClick={() => {
                    if (shouldIgnoreClick()) return;
                    setActiveSheetId(id);
                  }}
                >
                  {sheet.filename}
                </button>
                {viewModified && (
                  <>
                    <button
                      type="button"
                      className="sheet-node-action view-change-action"
                      aria-label="Save file view as new file"
                      title="Save file view as new file"
                      onClick={(event) => {
                        event.stopPropagation();
                        void saveSheetView(id);
                      }}
                    >
                      <Save size={ICON_SIZE_SMALL} />
                    </button>
                    <button
                      type="button"
                      className="sheet-node-action view-change-action"
                      aria-label="Reload original file view"
                      title="Reload original file view"
                      onClick={(event) => {
                        event.stopPropagation();
                        void reloadSheetView(id);
                      }}
                    >
                      <RotateCcw size={ICON_SIZE_SMALL} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="sheet-node-close"
                  aria-label="Close file"
                  onClick={(event) => {
                    event.stopPropagation();
                    void closeSheet(id);
                  }}
                >
                  <X size={ICON_SIZE_SMALL} />
                </button>
              </div>
              {sheet.children.length > 0 && (
                <ul className="sheet-children">
                  {sheet.children.map((childId) => (
                    <FilteredSheetNode
                      key={childId}
                      id={childId}
                      sheets={sheets}
                      activeSheetId={activeSheetId}
                      setActiveSheetId={setActiveSheetId}
                      closeFilteredSheet={closeFilteredSheet}
                      saveSheetView={saveSheetView}
                      reloadSheetView={reloadSheetView}
                    />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <div className="panel-header">
        <div />
        <button
          type="button"
          className="panel-toggle"
          aria-label="Close sheets panel"
          onClick={toggleSheetPanel}
        >
          <ChevronLeft size={ICON_SIZE_DEFAULT} />
        </button>
      </div>
    </div>
  );
}

export default SheetPanel;

import { useEffect, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { useDragReorder } from "../hooks/useDragReorder";
import { useRenameLabel } from "../hooks/useRenameLabel";
import { ICON_SIZE_SMALL } from "../constants";
import { rootSheetId } from "../utils/sheets";
import { reloadFileFromDisk } from "../utils/openFile";

function FileTabs() {
  const sheetOrder = useAppStore((state) => state.sheetOrder);
  const sheets = useAppStore((state) => state.sheets);
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const setActiveSheetId = useAppStore((state) => state.setActiveSheetId);
  const closeSheet = useAppStore((state) => state.closeSheet);
  const moveSheet = useAppStore((state) => state.moveSheet);
  const renameSheet = useAppStore((state) => state.renameSheet);
  const reloadSheet = useAppStore((state) => state.reloadSheet);
  const showError = useAppStore((state) => state.showError);
  const [contextMenu, setContextMenu] = useState(null);

  const { editingId, draft, setDraft, startEditing, commitEditing } =
    useRenameLabel(renameSheet);

  const activeSheet = activeSheetId ? sheets[activeSheetId] : null;
  const activeRootId = activeSheet ? rootSheetId(sheets, activeSheetId) : null;

  const {
    draggedItem: draggedSheetId,
    dropTarget,
    shouldIgnoreClick,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  } = useDragReorder({
    selector: "[data-file-tab]",
    axis: "x",
    onMove: moveSheet,
  });

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    const closeOnEscape = (event) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("blur", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("blur", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  async function reloadFromDisk() {
    const id = contextMenu?.id;
    setContextMenu(null);
    const sheet = sheets[id];
    if (!sheet?.token) return;
    try {
      const opened = await reloadFileFromDisk(sheet);
      if (opened) reloadSheet(id, opened);
    } catch (error) {
      showError(error);
    }
  }

  return (
    <div className="file-tabs">
      {sheetOrder.map((id) => (
        <div
          key={id}
          data-file-tab
          data-item={id}
          className={
            "file-tab" +
            (id === activeRootId ? " active" : "") +
            (draggedSheetId === id ? " dragging" : "") +
            (dropTarget?.item === id ? ` drag-over-${dropTarget.position}` : "")
          }
          onContextMenu={(event) => {
            if (!sheets[id].token) return;
            event.preventDefault();
            setContextMenu({ id, x: event.clientX, y: event.clientY });
          }}
        >
          {editingId === id ? (
            <input
              type="text"
              className="file-tab-label"
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitEditing}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          ) : (
            <button
              type="button"
              className="file-tab-label"
              onPointerDown={handlePointerDown(id)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onClick={() => {
                if (shouldIgnoreClick()) return;
                setActiveSheetId(id);
              }}
              onDoubleClick={() => {
                if (sheets[id].derived) {
                  startEditing(id, sheets[id].displayName ?? sheets[id].filename);
                }
              }}
            >
              {sheets[id].displayName ?? sheets[id].filename}
            </button>
          )}
          <button
            type="button"
            className="file-tab-close"
            aria-label="Close file"
            onClick={(event) => {
              event.stopPropagation();
              void closeSheet(id);
            }}
          >
            <X size={ICON_SIZE_SMALL} />
          </button>
        </div>
      ))}
      {contextMenu && (
        <ul
          className="file-menu-dropdown file-tab-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <li>
            <button type="button" onClick={() => void reloadFromDisk()}>
              <RotateCcw size={ICON_SIZE_SMALL} />
              Reload from disk
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

export default FileTabs;

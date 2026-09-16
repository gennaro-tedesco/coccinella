import { useAppStore } from "../store/useAppStore";

function SheetPanel() {
  const sheetOrder = useAppStore((state) => state.sheetOrder);
  const sheets = useAppStore((state) => state.sheets);
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const setActiveSheetId = useAppStore((state) => state.setActiveSheetId);

  return (
    <div className="sheet-panel">
      <div className="panel-title">Sheets</div>
      {sheetOrder.length === 0 && (
        <div className="panel-empty">No files open</div>
      )}
      <ul className="sheet-tree">
        {sheetOrder.map((id) => (
          <li key={id}>
            <button
              type="button"
              className={
                "sheet-node" + (id === activeSheetId ? " active" : "")
              }
              onClick={() => setActiveSheetId(id)}
            >
              {sheets[id].filename}
            </button>
            <ul className="sheet-versions" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default SheetPanel;

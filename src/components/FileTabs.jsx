import { useAppStore } from "../store/useAppStore";

function FileTabs() {
  const sheetOrder = useAppStore((state) => state.sheetOrder);
  const sheets = useAppStore((state) => state.sheets);
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const setActiveSheetId = useAppStore((state) => state.setActiveSheetId);

  return (
    <div className="file-tabs">
      {sheetOrder.map((id) => (
        <button
          key={id}
          type="button"
          className={"file-tab" + (id === activeSheetId ? " active" : "")}
          onClick={() => setActiveSheetId(id)}
        >
          {sheets[id].filename}
        </button>
      ))}
    </div>
  );
}

export default FileTabs;

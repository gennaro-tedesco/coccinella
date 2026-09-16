import { useAppStore } from "../store/useAppStore";
import { openCsvFile } from "../utils/openFile";

function EmptyState() {
  const openSheet = useAppStore((state) => state.openSheet);

  return (
    <div className="empty-state">
      <button type="button" onClick={() => openCsvFile(openSheet)}>
        Open File
      </button>
    </div>
  );
}

export default EmptyState;

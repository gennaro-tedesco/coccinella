import { useAppStore } from "../store/useAppStore";
import { openCsvFile } from "../utils/openFile";
import logo from "../assets/logo.png";

function EmptyState() {
  const openSheet = useAppStore((state) => state.openSheet);
  const showError = useAppStore((state) => state.showError);

  return (
    <div className="empty-state">
      <button
        type="button"
        onClick={() => void openCsvFile(openSheet).catch(showError)}
      >
        Open File
      </button>
      <img className="empty-state-logo" src={logo} alt="coccinella" />
    </div>
  );
}

export default EmptyState;

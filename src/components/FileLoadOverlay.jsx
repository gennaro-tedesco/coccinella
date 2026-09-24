import { useAppStore } from "../store/useAppStore";
import { formatBytes } from "../utils/stats";

function FileLoadOverlay() {
  const progress = useAppStore((state) => state.fileLoadProgress);
  const cancelFileLoad = useAppStore((state) => state.cancelFileLoad);
  if (!progress) return null;

  const percent = progress.totalBytes
    ? Math.min(100, Math.round((progress.bytesRead / progress.totalBytes) * 100))
    : 0;

  return (
    <div className="fuzzy-finder-overlay file-load-overlay" role="dialog" aria-modal="true">
      <div className="fuzzy-finder file-load-dialog">
        <strong>Loading {progress.filename}</strong>
        <progress max="100" value={percent}>{percent}%</progress>
        <div className="file-load-details">
          <span>{percent}%</span>
          <span>{formatBytes(progress.bytesRead)} / {formatBytes(progress.totalBytes)}</span>
        </div>
        <button type="button" disabled={progress.cancelling} onClick={cancelFileLoad}>
          {progress.cancelling ? "Cancelling..." : "Cancel"}
        </button>
      </div>
    </div>
  );
}

export default FileLoadOverlay;

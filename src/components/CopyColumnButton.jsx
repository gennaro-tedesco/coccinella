import { invoke } from "@tauri-apps/api/core";
import { Copy } from "lucide-react";
import { CELL_COPY_FEEDBACK_MS, ICON_SIZE_COMPACT } from "../constants";
import { useAppStore } from "../store/useAppStore";

let copyFeedbackTimeout;

function CopyColumnButton({ sheet, column }) {
  const showError = useAppStore((state) => state.showError);
  const setCopiedColumn = useAppStore((state) => state.setCopiedColumn);
  const copyWithQuotes = useAppStore((state) => state.copyWithQuotes);

  async function copyColumn(event) {
    event.stopPropagation();
    try {
      const text = await invoke("get_column_text", {
        datasetId: sheet.datasetId,
        column,
        withQuotes: copyWithQuotes,
      });
      await navigator.clipboard.writeText(text);
      window.clearTimeout(copyFeedbackTimeout);
      setCopiedColumn({ datasetId: sheet.datasetId, column });
      copyFeedbackTimeout = window.setTimeout(
        () => setCopiedColumn(null),
        CELL_COPY_FEEDBACK_MS,
      );
    } catch (error) {
      showError(error);
    }
  }

  return (
    <button
      type="button"
      className="column-copy-trigger"
      aria-label={`Copy ${column} column`}
      title={`Copy ${column} column`}
      onClick={copyColumn}
    >
      <Copy size={ICON_SIZE_COMPACT} />
    </button>
  );
}

export default CopyColumnButton;

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy } from "lucide-react";
import { CELL_COPY_FEEDBACK_MS, ICON_SIZE_COMPACT } from "../constants";
import { useAppStore } from "../store/useAppStore";

let copyFeedbackTimeout;
const pendingColumnCopies = new Set();

function CopyColumnButton({ sheet, column }) {
  const showError = useAppStore((state) => state.showError);
  const setCopiedColumn = useAppStore((state) => state.setCopiedColumn);
  const copyWithQuotes = useAppStore((state) => state.copyWithQuotes);
  const copyQuote = useAppStore((state) => state.copyQuote);
  const [isCopying, setIsCopying] = useState(false);

  async function copyColumn(event) {
    event.stopPropagation();
    const copyKey = JSON.stringify([sheet.datasetId, column]);
    if (pendingColumnCopies.has(copyKey)) return;
    pendingColumnCopies.add(copyKey);
    setIsCopying(true);
    try {
      const text = await invoke("get_column_text", {
        datasetId: sheet.datasetId,
        column,
        quote: copyWithQuotes ? copyQuote : null,
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
    } finally {
      pendingColumnCopies.delete(copyKey);
      setIsCopying(false);
    }
  }

  return (
    <button
      type="button"
      className="column-copy-trigger"
      aria-label={`Copy ${column} column`}
      title={`Copy ${column} column`}
      onClick={copyColumn}
      disabled={isCopying}
      aria-busy={isCopying}
    >
      <Copy size={ICON_SIZE_COMPACT} />
    </button>
  );
}

export default CopyColumnButton;

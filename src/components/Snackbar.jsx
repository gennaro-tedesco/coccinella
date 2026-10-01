import { useEffect, useState } from "react";
import { CircleAlert, X } from "lucide-react";
import {
  ERROR_SNACKBAR_VISIBLE_MS,
  ICON_SIZE_DEFAULT,
  ICON_SIZE_STATUS,
  SNACKBAR_EXIT_MS,
} from "../constants";

export function ErrorSnackbar({ children, onClose }) {
  const [isDismissing, setIsDismissing] = useState(false);

  useEffect(() => {
    setIsDismissing(false);
    if (!onClose) return undefined;

    const dismissTimeout = window.setTimeout(
      () => setIsDismissing(true),
      ERROR_SNACKBAR_VISIBLE_MS,
    );
    return () => window.clearTimeout(dismissTimeout);
  }, [children, onClose]);

  useEffect(() => {
    if (!isDismissing || !onClose) return undefined;

    const closeTimeout = window.setTimeout(onClose, SNACKBAR_EXIT_MS);
    return () => window.clearTimeout(closeTimeout);
  }, [isDismissing, onClose]);

  return (
    <div
      className={`snackbar snackbar-error${isDismissing ? " snackbar-dismissing" : ""}`}
      role="alert"
      aria-atomic="true"
      style={{ "--snackbar-exit-duration": `${SNACKBAR_EXIT_MS}ms` }}
    >
      <CircleAlert
        className="snackbar-icon"
        size={ICON_SIZE_STATUS}
        aria-hidden="true"
      />
      <div className="snackbar-message">{children}</div>
      {onClose && (
        <button
          type="button"
          className="snackbar-close"
          aria-label="Dismiss message"
          onClick={onClose}
        >
          <X size={ICON_SIZE_DEFAULT} />
        </button>
      )}
    </div>
  );
}

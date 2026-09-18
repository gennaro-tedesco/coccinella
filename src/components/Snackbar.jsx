import { CircleAlert, X } from "lucide-react";
import { ICON_SIZE_DEFAULT, ICON_SIZE_STATUS } from "../constants";

export function ErrorSnackbar({ children, onClose }) {
  return (
    <div
      className="snackbar snackbar-error"
      role="alert"
      aria-atomic="true"
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

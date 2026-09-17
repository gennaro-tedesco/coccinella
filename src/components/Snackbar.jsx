import { CircleAlert, Info, TriangleAlert, X } from "lucide-react";

const VARIANTS = {
  info: { Icon: Info, role: "status" },
  warning: { Icon: TriangleAlert, role: "alert" },
  error: { Icon: CircleAlert, role: "alert" },
};

function Snackbar({ children, onClose, variant }) {
  const { Icon, role } = VARIANTS[variant];

  return (
    <div
      className={`snackbar snackbar-${variant}`}
      role={role}
      aria-atomic="true"
    >
      <Icon className="snackbar-icon" size={18} aria-hidden="true" />
      <div className="snackbar-message">{children}</div>
      {onClose && (
        <button
          type="button"
          className="snackbar-close"
          aria-label="Dismiss message"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

export function InfoSnackbar(props) {
  return <Snackbar {...props} variant="info" />;
}

export function WarningSnackbar(props) {
  return <Snackbar {...props} variant="warning" />;
}

export function ErrorSnackbar(props) {
  return <Snackbar {...props} variant="error" />;
}

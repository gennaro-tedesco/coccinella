import { Component } from "react";

export default class LazyErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="chart-builder-placeholder">
        <div>
          <p>Chart tools could not be loaded.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload application
          </button>
        </div>
      </div>
    );
  }
}

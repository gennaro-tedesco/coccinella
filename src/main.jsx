import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initializeBenchmark } from "./hooks/useBenchmarkReady";

await initializeBenchmark();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

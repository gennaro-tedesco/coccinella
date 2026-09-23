import { useCallback, useEffect, useRef } from "react";
import { createJsonSearchClient } from "../utils/jsonSearchClient";

function createJsonSearchWorker() {
  return new Worker(
    new URL("../workers/jsonSearch.worker.js", import.meta.url),
    { type: "module" },
  );
}

export function useJsonSearchWorker() {
  const clientRef = useRef(null);
  clientRef.current ??= createJsonSearchClient(createJsonSearchWorker);

  useEffect(() => () => clientRef.current.terminate(), []);

  return useCallback(
    (document, query, isRegex, isCaseSensitive) =>
      clientRef.current.search(document, query, isRegex, isCaseSensitive),
    [],
  );
}

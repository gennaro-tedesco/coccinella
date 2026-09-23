export function createJsonSearchClient(createWorker) {
  let worker = null;
  let loadedDocument;
  let requestId = 0;

  function search(document, query, isRegex, isCaseSensitive) {
    worker ??= createWorker();
    const activeWorker = worker;
    requestId += 1;
    const id = requestId;
    const message = { id, query, isRegex, isCaseSensitive };
    if (loadedDocument !== document) {
      loadedDocument = document;
      message.document = document;
    }
    const response = new Promise((resolve, reject) => {
      function handleMessage({ data }) {
        if (data.id !== id) return;
        activeWorker.removeEventListener("message", handleMessage);
        if (data.error) reject(data.error);
        else resolve(data.matches);
      }
      activeWorker.addEventListener("message", handleMessage);
    });
    activeWorker.postMessage(message);
    return response;
  }

  function terminate() {
    worker?.terminate();
    worker = null;
    loadedDocument = undefined;
  }

  return { search, terminate };
}

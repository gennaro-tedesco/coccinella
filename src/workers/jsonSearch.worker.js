import { findJsonMatches } from "../utils/jsonTree";

let loadedDocument = null;

self.onmessage = ({ data: message }) => {
  if (message.document !== undefined) loadedDocument = message.document;
  try {
    self.postMessage({
      id: message.id,
      matches: findJsonMatches(
        loadedDocument,
        message.query,
        message.isRegex,
        message.isCaseSensitive,
      ),
    });
  } catch (error) {
    self.postMessage({ id: message.id, error: String(error) });
  }
};

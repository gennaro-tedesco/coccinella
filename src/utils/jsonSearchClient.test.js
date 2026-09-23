import { describe, expect, it } from "vitest";
import { createJsonSearchClient } from "./jsonSearchClient";
import { findJsonMatches } from "./jsonTree";

function createFakeWorker() {
  const listeners = new Set();
  let loadedDocument = null;
  const worker = {
    posted: [],
    terminated: false,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    terminate: () => {
      worker.terminated = true;
    },
    postMessage: (message) => {
      worker.posted.push(message);
      if (message.document !== undefined) loadedDocument = message.document;
      let data;
      try {
        data = {
          id: message.id,
          matches: findJsonMatches(
            loadedDocument,
            message.query,
            message.isRegex,
            message.isCaseSensitive,
          ),
        };
      } catch (error) {
        data = { id: message.id, error: String(error) };
      }
      queueMicrotask(() => {
        for (const listener of [...listeners]) listener({ data });
      });
    },
  };
  return worker;
}

describe("createJsonSearchClient", () => {
  it("posts searches to the worker and resolves with its matches", async () => {
    const workers = [];
    const client = createJsonSearchClient(() => {
      const worker = createFakeWorker();
      workers.push(worker);
      return worker;
    });
    const document = { title: "hello" };

    await expect(client.search(document, "hello", false, false)).resolves.toEqual([
      { path: ["title"] },
    ]);
    await expect(client.search(document, "missing", false, false)).resolves.toEqual([]);

    expect(workers).toHaveLength(1);
    expect(workers[0].posted.map((message) => "document" in message)).toEqual([
      true,
      false,
    ]);
  });

  it("rejects with the worker error", async () => {
    const client = createJsonSearchClient(createFakeWorker);

    await expect(client.search({ a: "b" }, "(", true, false)).rejects.toMatch(
      "SyntaxError",
    );
  });

  it("resends the document to a worker created after termination", async () => {
    const workers = [];
    const client = createJsonSearchClient(() => {
      const worker = createFakeWorker();
      workers.push(worker);
      return worker;
    });
    const document = { title: "hello" };

    await client.search(document, "hello", false, false);
    client.terminate();
    await expect(client.search(document, "hello", false, false)).resolves.toEqual([
      { path: ["title"] },
    ]);

    expect(workers[0].terminated).toBe(true);
    expect("document" in workers[1].posted[0]).toBe(true);
  });
});

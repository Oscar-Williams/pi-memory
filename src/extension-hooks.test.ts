/**
 * Drives the extension through its registered hooks and tools with a stub
 * ExtensionAPI, so behaviour is checked end-to-end rather than per helper.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import piMemory from "./index.js";

type Api = Parameters<typeof piMemory>[0];
type Handler = (event: unknown, ctx: unknown) => unknown;
type Tool = { execute: (...args: unknown[]) => Promise<{ content: { text: string }[] }> };

function createHarness(memorySettings: Record<string, unknown>) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "pi-memory-hooks-"));
  fs.mkdirSync(path.join(project, ".pi"), { recursive: true });
  fs.writeFileSync(
    path.join(project, ".pi", "settings.json"),
    JSON.stringify({ "pi-memory": { localPath: path.join(project, "memory") }, memory: memorySettings }),
  );

  const handlers = new Map<string, Handler>();
  const tools = new Map<string, Tool>();
  const notifications: { text: string; level?: string }[] = [];
  const pi = {
    on: (name: string, h: Handler) => void handlers.set(name, h),
    registerTool: (t: Tool & { name: string }) => void tools.set(t.name, t),
    registerCommand() {},
    sendMessage() {},
    exec: async () => ({ code: 0, stdout: '{"semantic":[],"lessons":[]}' }),
  };
  piMemory(pi as unknown as Api);

  const ctx = {
    cwd: project,
    hasUI: true,
    ui: {
      setStatus() {},
      notify: (text: string, level?: string) => void notifications.push({ text, level }),
    },
    sessionManager: { getBranch: () => [], getEntries: () => [] },
  };

  const call = async (tool: string, params: Record<string, unknown>) =>
    (await tools.get(tool)!.execute("id", params, undefined, undefined, ctx)).content[0]!.text;

  return {
    ctx,
    handlers,
    notifications,
    call,
    async cleanup() {
      await handlers.get("session_shutdown")?.({}, ctx);
      fs.rmSync(project, { recursive: true, force: true });
    },
  };
}

async function withoutEnv<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const saved = process.env[name];
  delete process.env[name];
  try {
    return await fn();
  } finally {
    if (saved !== undefined) process.env[name] = saved;
  }
}

describe("embedding failures are surfaced, not silent (#30)", () => {
  it("notifies once with cause and fix, and keyword search keeps working", async () => {
    await withoutEnv("OPENAI_API_KEY", async () => {
      const h = createHarness({ embedding: { type: "openai" } });
      try {
        await h.handlers.get("session_start")!({}, h.ctx);

        assert.equal(h.notifications.length, 1);
        const [note] = h.notifications;
        assert.equal(note!.level, "warning");
        assert.match(note!.text, /semantic search unavailable: no API key is configured for openai embeddings/);
        assert.match(note!.text, /OPENAI_API_KEY/);
        assert.match(note!.text, /Keyword search still works/);

        await h.call("memory_remember", { type: "fact", key: "pref.editor", value: "nvim with lazy.nvim" });
        assert.match(await h.call("memory_search", { query: "editor" }), /pref\.editor: nvim with lazy\.nvim/);
        assert.match(await h.call("memory_stats", {}), /Semantic search is failing: no API key/);
        assert.equal(h.notifications.length, 1, "same cause must not be re-notified");
      } finally {
        await h.cleanup();
      }
    });
  });

  it("reports a provider that fails at query time and still returns lexical hits", async () => {
    // Loopback port 9 refuses connections immediately; no network needed.
    const h = createHarness({ embedding: { type: "ollama", url: "http://127.0.0.1:9" } });
    try {
      await h.handlers.get("session_start")!({}, h.ctx);
      assert.equal(h.notifications.length, 0, "nothing to embed yet, nothing to report");

      await h.call("memory_remember", { type: "fact", key: "tool.jq.usage", value: "prefer jq over python for JSON" });
      assert.match(await h.call("memory_search", { query: "jq" }), /tool\.jq\.usage/);

      assert.equal(h.notifications.length, 1);
      assert.match(h.notifications[0]!.text, /Ollama is not reachable at http:\/\/127\.0\.0\.1:9/);
      assert.match(h.notifications[0]!.text, /ollama serve/);
    } finally {
      await h.cleanup();
    }
  });
});

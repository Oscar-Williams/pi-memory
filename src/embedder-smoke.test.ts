/**
 * Real-subprocess check that a missing optional AWS SDK degrades instead of
 * crashing (#30). Runs a copy of embedder.ts from a temp dir, where
 * @aws-sdk/* cannot resolve, because the repo's node_modules always has it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const RUNNER = `
import { createEmbedder, diagnoseEmbedderError } from "./embedder.ts";
const emb = createEmbedder({ type: "bedrock" });
// Constructed but never awaited, as when backfill finds nothing to embed.
await new Promise((r) => setTimeout(r, 200));
try {
  await emb.embed("hello");
  console.log("UNEXPECTED: embed resolved");
} catch (err) {
  console.log("CODE", err.code);
  console.log("REASON", diagnoseEmbedderError(err, { type: "bedrock" }, "/pkg").reason);
}
console.log("ALIVE");
`;

test("bedrock embedder without the AWS SDK rejects on use and never crashes the process", { timeout: 30_000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-memory-nosdk-"));
  try {
    fs.copyFileSync(fileURLToPath(new URL("./embedder.ts", import.meta.url)), path.join(dir, "embedder.ts"));
    fs.writeFileSync(path.join(dir, "runner.ts"), RUNNER);
    fs.writeFileSync(path.join(dir, "package.json"), '{ "type": "module" }\n');

    const res = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "runner.ts"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20_000,
    });

    assert.equal(res.signal, null, `killed by ${res.signal}`);
    assert.equal(res.status, 0, `exit ${res.status}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
    assert.match(res.stdout, /CODE ERR_MODULE_NOT_FOUND/);
    assert.match(res.stdout, /REASON .*AWS SDK/);
    assert.match(res.stdout, /ALIVE/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

interface PackageManifest {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

test("does not install or advertise the legacy vector backend", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as PackageManifest;

  for (const dependencies of [
    manifest.dependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ]) {
    assert.equal(dependencies?.["@xenova/transformers"], undefined);
  }
});

test("does not install a duplicate Pi host in consumers", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as PackageManifest;

  assert.equal(
    manifest.peerDependenciesMeta?.["@earendil-works/pi-coding-agent"]?.optional,
    true,
  );
});

test("runtime dependency tree needs no install scripts (#30)", async () => {
  // Installers that block lifecycle scripts (pi's own, `--ignore-scripts`,
  // pnpm's allow-list) once left the native `sharp` binding unbuilt and
  // silently disabled semantic search. Keep the runtime tree script-free.
  const lock = JSON.parse(
    await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
  ) as { packages: Record<string, { dev?: boolean; hasInstallScript?: boolean }> };

  const runtime = Object.entries(lock.packages).filter(([path, meta]) => path && !meta.dev);
  assert.ok(runtime.length > 0, "lockfile lists runtime packages");
  assert.deepEqual(
    runtime.filter(([, meta]) => meta.hasInstallScript).map(([path]) => path),
    [],
  );
  assert.deepEqual(
    runtime.map(([path]) => path).filter((p) => /\/(sharp|@xenova|onnxruntime[^/]*)$/.test(p)),
    [],
  );
});

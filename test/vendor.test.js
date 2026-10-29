import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const manifest = JSON.parse(readFileSync(new URL("../vendor/mermaid/manifest.json", import.meta.url), "utf8"));
const chunk = readFileSync(new URL("../lib/client.mermaid.js", import.meta.url), "utf8");

test("the vendored chunk registers under the native DSH package-local name", () => {
  let registration;
  vm.runInNewContext(chunk, {
    window: { __ModuleLoader__: { load: (value) => { registration = value; } } },
  });
  assert.equal(registration.id, "dsh-plugin-mermaid");
  assert.equal(registration.chunk, "client.mermaid.js");
  assert.equal(typeof registration.factory, "function");
  assert.doesNotMatch(chunk, /\bimport\s*\(/);
});

test("the upstream payload is byte-for-byte intact apart from its global export", () => {
  const start = chunk.indexOf("// BEGIN UPSTREAM MERMAID\n");
  const end = chunk.lastIndexOf("// END UPSTREAM MERMAID\n");
  assert.ok(start >= 0 && end > start);
  const original = chunk.slice(start + "// BEGIN UPSTREAM MERMAID\n".length, end) +
    'globalThis["mermaid"] = globalThis.__esbuild_esm_mermaid_nm["mermaid"].default;\n';
  assert.equal(createHash("sha256").update(original).digest("hex"), manifest.sha256);
  assert.match(original, /Bundled license information/);
  assert.match(readFileSync(new URL("../vendor/mermaid/LICENSE", import.meta.url), "utf8"), /MIT/);
});

test("published plugin files include the runtime chunk and its license/provenance", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(pkg.files.includes("lib"));
  assert.ok(pkg.files.includes("vendor"));
  assert.ok(pkg.files.includes("scripts/vendor-mermaid.mjs"));
  assert.equal(manifest.name, "mermaid");
  assert.equal(manifest.version, "12.2.0");
});

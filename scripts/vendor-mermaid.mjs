import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, utimes, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(new URL("../vendor/mermaid/manifest.json", import.meta.url), "utf8"));
const packageDir = process.argv[2];
assert.ok(packageDir, "Usage: npm run vendor:mermaid -- /path/to/extracted/mermaid/package");
const pkg = JSON.parse(await readFile(resolve(packageDir, "package.json"), "utf8"));
assert.equal(pkg.name, manifest.name);
assert.equal(pkg.version, manifest.version);
const original = await readFile(resolve(packageDir, manifest.entry), "utf8");
assert.equal(createHash("sha256").update(original).digest("hex"), manifest.sha256,
  "Upstream Mermaid bytes do not match the recorded SHA-256");

// The upstream IIFE ends with a window-global export; DSH needs a factory return.
const globalExport = 'globalThis["mermaid"] = globalThis.__esbuild_esm_mermaid_nm["mermaid"].default;\n';
assert.ok(original.endsWith(globalExport), "Upstream export changed; review the DSH adapter before updating");
const body = original.slice(0, -globalExport.length);
const license = await readFile(resolve(packageDir, "LICENSE"));
const bundled = `/*! Mermaid ${manifest.version}. See vendor/mermaid for license and provenance. */
window.__ModuleLoader__.load({
  id: "dsh-plugin-mermaid",
  chunk: "client.mermaid.js",
  factory: () => {
// BEGIN UPSTREAM MERMAID
${body}// END UPSTREAM MERMAID
    return __esbuild_esm_mermaid_nm.mermaid.default;
  },
});
`;
await writeFile(resolve(root, "lib/client.mermaid.js"), bundled);
await writeFile(resolve(root, "vendor/mermaid/LICENSE"), license);
// DSH versions sibling chunks using the entry artifact's timestamp.
const now = new Date();
await utimes(resolve(root, "lib/client.js"), now, now);
console.log(`Vendored Mermaid ${manifest.version}: ${Buffer.byteLength(bundled)} bytes`);

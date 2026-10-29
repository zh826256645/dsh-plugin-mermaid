# Vendored Mermaid

This directory records the provenance and MIT license of the official Mermaid
package. Its complete prebuilt `dist/mermaid.min.js` distribution, including
the upstream bundled dependency notices, is stored in `lib/client.mermaid.js`.
It is part of the repository and the published plugin package; no runtime
download, package install, or build is required.

The source version, official npm tarball, npm integrity, and original file
SHA-256 are recorded in `manifest.json`. The DSH adapter wraps the upstream
IIFE as a package-local lazy chunk and replaces only the final window-global
export with a factory return. This avoids introducing a global `mermaid`
variable. The rendering code and embedded third-party license comments are
otherwise unchanged.

## Reproduce The Checked-In Chunk

Download the exact official package recorded in `manifest.json`:

```sh
npm pack mermaid@12.2.0 --registry=https://registry.npmjs.org \
  --pack-destination /tmp
mkdir -p /tmp/mermaid-vendor
tar -xzf /tmp/mermaid-12.2.0.tgz -C /tmp/mermaid-vendor
npm run vendor:mermaid -- /tmp/mermaid-vendor/package
npm test
```

Only this maintenance operation needs network access. The generator verifies
the package name/version and original entry SHA-256 before writing output.
It also stamps `lib/client.js` so DSH publishes a new owner revision and
browsers do not reuse an immutable URL for a changed sibling chunk.
For a deliberate upgrade, obtain the new official tarball and integrity,
update the manifest's version/source/hash, regenerate, and rerun the browser
fixtures with external requests blocked and browser caching disabled.

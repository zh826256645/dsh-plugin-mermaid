import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

function loadClient(mermaid = {}, load = async () => mermaid) {
  let client;
  let dark = false;
  const requests = [];
  const require = {
    async: async (request) => {
      assert.equal(request, "./client.mermaid.js");
      requests.push(request);
      return await load();
    },
  };
  const context = {
    window: { __ModuleLoader__: { load: ({ factory }) => { client = factory(require); } } },
    document: { body: { hasAttribute: () => dark } },
    getComputedStyle: () => ({ fontFamily: '"Test Sans", sans-serif' }),
    setTimeout,
    clearTimeout,
    console,
  };
  // Exercise the shipped factory without adding a test API to the browser bundle.
  vm.runInNewContext(source
    .replace("exports.name = name;", `exports.test = {
      loadMermaid, currentTheme, renderConfig, chartSize, sizeChart, sizeInlineChart, isMermaidBlock, renderOne, scheduleRender
    }; exports.name = name;`), context);
  return { ...client.test, requests, setDark: (value) => { dark = value; } };
}

test("Mermaid loads once from the local DSH chunk, with no CDN fallback", async () => {
  const api = { render() {} };
  const client = loadClient(api);
  assert.equal(client.requests.length, 0);
  const first = client.loadMermaid();
  assert.equal(client.loadMermaid(), first);
  assert.equal(await first, api);
  assert.deepEqual(client.requests, ["./client.mermaid.js"]);
  assert.doesNotMatch(source, /https?:\/\/|MERMAID_CDN/);
});

test("a failed local chunk load can be retried", async () => {
  const api = { render() {} };
  let calls = 0;
  const client = loadClient(api, async () => {
    if (++calls === 1) throw new Error("local chunk unavailable");
    return api;
  });
  await assert.rejects(client.loadMermaid(), /local chunk unavailable/);
  assert.equal(await client.loadMermaid(), api);
  assert.equal(calls, 2);
});

function block(text, language = "mermaid") {
  const attributes = new Map(language ? [["data-code-language", language]] : []);
  const code = { textContent: text, className: "" };
  const chart = {
    viewBox: { baseVal: { width: 420, height: 80 } },
    style: {},
    getAttribute: () => null,
  };
  const stage = { innerHTML: "", querySelector: () => chart };
  const error = {};
  const expand = {};
  return {
    code, stage, error, expand, isConnected: true,
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    querySelector: (selector) => {
      if (selector.includes("pre code") || selector.startsWith("code.")) return code;
      if (selector === ".dsh-mermaid-stage") return stage;
      if (selector === ".dsh-mermaid-stage svg") return stage.innerHTML ? chart : null;
      if (selector === ".dsh-mermaid-error") return error;
      if (selector === "[data-dsh-mermaid-expand]") return expand;
      return null;
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("light and dark themes use real host fonts and keep strict security", () => {
  const client = loadClient();
  for (const theme of ["light", "dark"]) {
    const config = client.renderConfig(theme);
    assert.equal(config.fontFamily, '"Test Sans", sans-serif');
    assert.equal(config.themeVariables.fontFamily, config.fontFamily);
    assert.equal(config.securityLevel, "strict");
    assert.equal(config.theme, "base");
    assert.equal(config.themeVariables.darkMode, theme === "dark");
    assert.match(config.themeVariables.primaryColor, /^#[0-9a-f]{6}$/);
  }
  assert.notEqual(client.renderConfig("light").themeVariables.primaryTextColor,
    client.renderConfig("dark").themeVariables.primaryTextColor);
  assert.equal(client.currentTheme(), "light");
  client.setDark(true);
  assert.equal(client.currentTheme(), "dark");
});

test("natural SVG dimensions remain readable and scale proportionally", () => {
  const client = loadClient();
  const svg = block("").stage.querySelector("svg");
  client.sizeChart(svg);
  assert.equal(svg.style.width, "420px");
  assert.equal(svg.style.height, "80px");
  client.sizeChart(svg, 1.5);
  assert.equal(svg.style.width, "630px");
  assert.equal(svg.style.height, "120px");
  assert.equal(svg.style.maxWidth, "none");
});

test("returning from the viewer restores responsive inline dimensions", () => {
  const client = loadClient();
  const svg = block("").stage.querySelector("svg");
  client.sizeChart(svg, 2);
  client.sizeInlineChart(svg);
  assert.equal(svg.style.width, "420px");
  assert.equal(svg.style.height, "auto");
  assert.equal(svg.style.maxWidth, "");
});

test("explicit non-Mermaid code is not enhanced; declaration fallback still works", () => {
  const { isMermaidBlock } = loadClient();
  assert.equal(isMermaidBlock(block("flowchart LR\n A --> B", "javascript")), false);
  assert.equal(isMermaidBlock(block("flowchart LR\n A --> B", "")), true);
  assert.equal(isMermaidBlock(block("---\ntitle: Test\n---\n%% comment\nsequenceDiagram\n A->>B: Hi", "")), true);
  assert.equal(isMermaidBlock(block("const answer = 42", "")), false);
});

test("a source update cannot be overwritten by an older asynchronous render", async () => {
  const started = deferred();
  const finish = deferred();
  const client = loadClient({
    initialize() {},
    async render() { started.resolve(); await finish.promise; return { svg: "old SVG" }; },
  });
  const wrapper = block("flowchart LR\n A --> B");
  const rendering = client.renderOne(wrapper);
  await started.promise;
  wrapper.code.textContent = "flowchart LR\n A --> C";
  finish.resolve();
  await rendering;
  assert.equal(wrapper.stage.innerHTML, "");
  assert.equal(wrapper.getAttribute("data-dsh-mermaid-hash"), null);
});

test("a theme update also discards outdated errors", async () => {
  const started = deferred();
  const finish = deferred();
  const client = loadClient({
    initialize() {},
    async render() { started.resolve(); await finish.promise; throw new Error("old error"); },
  });
  const wrapper = block("flowchart LR\n A --> B");
  const rendering = client.renderOne(wrapper);
  await started.promise;
  client.setDark(true);
  finish.resolve();
  await rendering;
  assert.equal(wrapper.error.textContent, undefined);
  assert.notEqual(wrapper.getAttribute("data-dsh-mermaid-state"), "error");
});

test("a failed diagram preserves source and can recover on the next render", async () => {
  let fail = true;
  const client = loadClient({
    initialize() {},
    async render() {
      if (fail) throw new Error("invalid diagram");
      return { svg: "new SVG" };
    },
  });
  const wrapper = block("flowchart LR\n A --> B");
  await client.renderOne(wrapper);
  assert.equal(wrapper.getAttribute("data-dsh-mermaid-state"), "error");
  assert.match(wrapper.error.textContent, /invalid diagram/);
  assert.equal(wrapper.expand.disabled, true);
  fail = false;
  await client.renderOne(wrapper);
  assert.equal(wrapper.stage.innerHTML, "new SVG");
  assert.equal(wrapper.getAttribute("data-dsh-mermaid-state"), "ok");
  assert.equal(wrapper.expand.disabled, false);
});

test("reverting to the last successful source clears a newer parse error", async () => {
  let renders = 0;
  const client = loadClient({
    initialize() {},
    async render(id, text) {
      renders++;
      if (text === "invalid") throw new Error("parse error");
      return { svg: "valid SVG" };
    },
  });
  const wrapper = block("valid");
  await client.renderOne(wrapper);
  wrapper.code.textContent = "invalid";
  await client.renderOne(wrapper);
  assert.equal(wrapper.getAttribute("data-dsh-mermaid-state"), "error");
  wrapper.code.textContent = "valid";
  await client.renderOne(wrapper);
  assert.equal(wrapper.getAttribute("data-dsh-mermaid-state"), "ok");
  assert.equal(wrapper.error.hidden, true);
  assert.equal(wrapper.stage.innerHTML, "valid SVG");
  assert.equal(renders, 2);
});

test("scheduled diagrams serialize global configuration and rendering", { timeout: 2000 }, async () => {
  const events = [];
  const started = deferred();
  const finish = deferred();
  const complete = deferred();
  const client = loadClient({
    initialize() { events.push("initialize"); },
    async render(id, text) {
      events.push(text);
      if (text === "first") { started.resolve(); await finish.promise; }
      else complete.resolve();
      return { svg: text };
    },
  });
  client.scheduleRender(block("first"), { force: true });
  client.scheduleRender(block("second"), { force: true });
  await started.promise;
  assert.deepEqual(events, ["initialize", "first"]);
  finish.resolve();
  await complete.promise;
  assert.deepEqual(events, ["initialize", "first", "initialize", "second"]);
});

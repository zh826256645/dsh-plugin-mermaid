/*! dsh-plugin-mermaid/client.js
 *  Browser entry: must be a factory-form CJS bundle registered with
 *  window.__ModuleLoader__.load({ id, factory }). The Node half of DSH's
 *  client-modules service scans the `dsh.client` package field, serves
 *  this file under /plugins/<id>/client.js, and the browser kernel
 *  materializes it on boot.
 */
window.__ModuleLoader__.load({
  id: "dsh-plugin-mermaid",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const PLUGIN_ID = "dsh-plugin-mermaid";
    const RENDER_DEBOUNCE_MS = 500;

    // ── Markers ────────────────────────────────────────────────────────────
    // `data-dsh-mermaid="ready"`   : wrapper has been enhanced (views built)
    // `data-dsh-mermaid-view`      : on wrapper, "chart" | "source"
    // `data-dsh-mermaid-state`     : on wrapper, "idle" | "rendering" | "ok" | "error"
    // `data-dsh-mermaid-hash`      : last rendered source hash (to skip re-render)

    // ── Mermaid loader (vendored package-local DSH chunk) ──────────────────
    let mermaidPromise = null;
    function loadMermaid() {
      if (mermaidPromise) return mermaidPromise;
      mermaidPromise = require.async("./client.mermaid.js").then(
        (mod) => mod.default ?? mod,
      ).catch((error) => {
        mermaidPromise = null;
        throw error;
      });
      return mermaidPromise;
    }

    function currentTheme() {
      // ui-layout sets body[data-ds-dark-theme] when in dark mode;
      // absence means light (system resolves the same attribute).
      if (document.body && document.body.hasAttribute("data-ds-dark-theme")) {
        return "dark";
      }
      return "light";
    }

    function renderConfig(theme) {
      const dark = theme === "dark";
      const fontFamily = getComputedStyle(document.body).fontFamily;
      const text = dark ? "#e4e7e5" : "#242b28";
      const muted = dark ? "#a0aaa5" : "#66736c";
      const surface = dark ? "#252b28" : "#f5f7f6";
      const border = dark ? "#56635b" : "#cbd5ce";
      const accent = dark ? "#29453b" : "#e9f3ed";
      return {
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: "base",
        fontFamily,
        fontSize: 14,
        flowchart: { curve: "basis", nodeSpacing: 40, rankSpacing: 56, padding: 18 },
        sequence: { actorMargin: 48, messageMargin: 36, mirrorActors: false },
        themeVariables: {
          darkMode: dark,
          fontFamily,
          fontSize: "14px",
          background: dark ? "#1c201e" : "#ffffff",
          primaryColor: surface,
          primaryTextColor: text,
          primaryBorderColor: border,
          secondaryColor: accent,
          secondaryTextColor: text,
          secondaryBorderColor: border,
          tertiaryColor: surface,
          tertiaryTextColor: text,
          tertiaryBorderColor: border,
          lineColor: muted,
          textColor: text,
          mainBkg: surface,
          nodeBorder: border,
          clusterBkg: dark ? "#202622" : "#f9faf9",
          clusterBorder: border,
          edgeLabelBackground: dark ? "#1c201e" : "#ffffff",
          titleColor: text,
          actorBkg: surface,
          actorBorder: border,
          actorTextColor: text,
          actorLineColor: border,
          signalColor: muted,
          signalTextColor: text,
          labelBoxBkgColor: accent,
          labelBoxBorderColor: border,
          labelTextColor: text,
          loopTextColor: text,
          noteBkgColor: accent,
          noteBorderColor: border,
          noteTextColor: text,
          activationBkgColor: accent,
          activationBorderColor: border,
        },
        themeCSS: ".node rect.basic { rx: 8px; ry: 8px; }",
      };
    }

    function chartSize(svg) {
      const box = svg.viewBox?.baseVal;
      return {
        width: box?.width || parseFloat(svg.getAttribute("width")) || 800,
        height: box?.height || parseFloat(svg.getAttribute("height")) || 400,
      };
    }

    function sizeChart(svg, scale = 1) {
      const { width, height } = chartSize(svg);
      svg.style.maxWidth = "none";
      svg.style.width = `${width * scale}px`;
      svg.style.height = `${height * scale}px`;
    }

    function sizeInlineChart(svg) {
      sizeChart(svg);
      svg.style.maxWidth = "";
      svg.style.height = "auto";
    }

    function button(text, title, onClick) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dsh-mermaid-btn";
      b.textContent = text;
      b.title = title;
      b.setAttribute("aria-label", title);
      if (onClick) b.addEventListener("click", (event) => {
        event.stopPropagation();
        onClick();
      });
      return b;
    }

    // Move, rather than clone, the SVG so IDs, markers and authored styles stay unique.
    let viewer = null;
    function openViewer(wrapper) {
      if (viewer) return;
      const svg = wrapper.querySelector(".dsh-mermaid-stage svg");
      if (!svg) return;
      const opener = document.activeElement;
      const dialog = document.createElement("dialog");
      dialog.className = "dsh-mermaid-viewer";
      dialog.setAttribute("aria-label", "Mermaid 图表查看器");
      const toolbar = document.createElement("div");
      toolbar.className = "dsh-mermaid-viewer-toolbar";
      const title = document.createElement("strong");
      title.textContent = "Mermaid";
      const zoomLabel = document.createElement("output");
      zoomLabel.setAttribute("aria-label", "缩放比例");
      const viewport = document.createElement("div");
      viewport.className = "dsh-mermaid-viewport";
      viewport.tabIndex = 0;
      viewport.setAttribute("aria-label", "图表画布，可滚动查看");
      const stage = document.createElement("div");
      stage.className = "dsh-mermaid-stage";
      const placeholder = document.createElement("div");
      const bounds = svg.getBoundingClientRect();
      placeholder.style.width = `${bounds.width}px`;
      placeholder.style.height = `${bounds.height}px`;
      placeholder.setAttribute("aria-hidden", "true");
      svg.replaceWith(placeholder);
      stage.appendChild(svg);
      viewport.appendChild(stage);
      let scale = 1;
      const zoom = (next, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) => {
        const oldWidth = stage.scrollWidth;
        const oldHeight = stage.scrollHeight;
        const centerX = viewport.scrollLeft + x;
        const centerY = viewport.scrollTop + y;
        const previous = scale;
        scale = Math.max(0.1, Math.min(4, next));
        sizeChart(stage.querySelector("svg"), scale);
        zoomLabel.textContent = `${Math.round(scale * 100)}%`;
        viewport.scrollLeft = centerX * scale / previous +
          (stage.scrollWidth - oldWidth * scale / previous) / 2 - x;
        viewport.scrollTop = centerY * scale / previous +
          (stage.scrollHeight - oldHeight * scale / previous) / 2 - y;
      };
      const fit = () => {
        const { width, height } = chartSize(stage.querySelector("svg"));
        zoom(Math.min(1, (viewport.clientWidth - 48) / width, (viewport.clientHeight - 48) / height));
      };
      const close = button("关闭", "关闭图表查看器", () => dialog.close());
      toolbar.append(
        title,
        button("−", "缩小图表", () => zoom(scale / 1.25)),
        zoomLabel,
        button("+", "放大图表", () => zoom(scale * 1.25)),
        button("100%", "按原始大小查看", () => zoom(1)),
        button("适应窗口", "适应窗口", fit),
        close,
      );
      const hint = document.createElement("div");
      hint.className = "dsh-mermaid-viewer-hint";
      hint.textContent = "拖动平移 · Ctrl / ⌘ + 滚轮缩放 · Esc 关闭";
      dialog.append(toolbar, viewport, hint);
      viewer = { wrapper, stage, refresh: () => zoom(scale) };
      dialog.addEventListener("close", () => {
        const chart = stage.querySelector("svg");
        if (chart) {
          sizeInlineChart(chart);
          wrapper.querySelector(".dsh-mermaid-stage")?.replaceChildren(chart);
        }
        viewer = null;
        dialog.remove();
        if (opener?.isConnected) opener.focus();
      }, { once: true });
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) {
          const bounds = dialog.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right ||
              event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
        }
      });
      viewport.addEventListener("wheel", (event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        const bounds = viewport.getBoundingClientRect();
        zoom(scale * Math.exp(-event.deltaY * 0.005), event.clientX - bounds.left, event.clientY - bounds.top);
      }, { passive: false });
      let drag = null;
      viewport.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.pointerType !== "mouse" || event.target.closest("a, button")) return;
        event.preventDefault();
        drag = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
        viewport.setPointerCapture(event.pointerId);
        viewport.classList.add("is-dragging");
      });
      viewport.addEventListener("pointermove", (event) => {
        if (!drag) return;
        viewport.scrollLeft = drag.left - event.clientX + drag.x;
        viewport.scrollTop = drag.top - event.clientY + drag.y;
      });
      const endDrag = () => {
        drag = null;
        viewport.classList.remove("is-dragging");
      };
      viewport.addEventListener("lostpointercapture", endDrag);
      viewport.addEventListener("pointerup", endDrag);
      viewport.addEventListener("pointercancel", endDrag);
      document.body.appendChild(dialog);
      dialog.showModal();
      fit();
      close.focus();
    }

    // Stable short hash to skip identical re-renders while streaming.
    function hashString(s) {
      let h = 5381;
      for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
      return (h >>> 0).toString(36);
    }

    // ── Block detection ────────────────────────────────────────────────────
    // New code-card toolbars replace unsupported language names with localized
    // generic copy. When no language metadata remains, recognize a Mermaid
    // declaration at the start of the source, after frontmatter and comments.
    function isMermaidBlock(wrapper) {
      const code = wrapper.querySelector("pre code");
      const language = wrapper.getAttribute("data-code-language") ||
        /(?:^|\s)language-([\w-]+)/.exec(code?.className || "")?.[1];
      if (language) return language.toLowerCase() === "mermaid";
      const info = wrapper.querySelector('[class*="infostring"]');
      if (info && info.textContent.trim()) return info.textContent.trim().toLowerCase() === "mermaid";
      const label = wrapper.querySelector('[data-code-block-banner] [class*="language"]')?.textContent.trim();
      if (label?.toLowerCase() === "mermaid") return true;
      // Generic labels are localized; an ASCII language id is explicit metadata.
      if (label && /^[a-z][\w+#.-]*$/i.test(label) && !/^(code|code block|plain(?:text)?|text)$/i.test(label)) return false;
      const source = (code?.textContent || "").trimStart()
        .replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "")
        .replace(/^[ \t]*%%[^\r\n]*(?:\r?\n|$)/gm, "").trimStart();
      return /^(?:sequenceDiagram|flowchart|graph|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|C4(?:Context|Container|Component|Dynamic|Deployment)|(?:xychart|block|packet|architecture|radar|treemap|sankey)-beta|kanban)(?=[ \t;\r\n]|$)/.test(source);
    }

    function findCodeEl(wrapper) {
      return (
        wrapper.querySelector("code.language-mermaid, code[class*='language-mermaid']") ||
        wrapper.querySelector("pre code")
      );
    }

    // ── View construction ──────────────────────────────────────────────────
    function buildViews(wrapper, codeEl) {
      if (wrapper.hasAttribute("data-dsh-mermaid")) return;
      wrapper.setAttribute("data-dsh-mermaid", "ready");
      wrapper.setAttribute("data-dsh-mermaid-view", "chart");
      wrapper.setAttribute("data-dsh-mermaid-scale", "fit");
      wrapper.setAttribute("data-dsh-mermaid-state", "idle");

      const actionArea = wrapper.querySelector('[data-code-block-banner] [class*="actions"], [class*="banner"] [class*="action"]');
      const nativePre = codeEl.closest("pre");
      const label = wrapper.querySelector('[data-code-block-banner] [class*="language"], [class*="infostring"]');
      if (label) label.textContent = "Mermaid";

      const toggleBtn = button("源码", "切换到 Mermaid 源码", null);
      const sizeBtn = button("原尺寸", "按原始大小查看内嵌图表", () => {
        const fit = wrapper.getAttribute("data-dsh-mermaid-scale") !== "actual";
        wrapper.setAttribute("data-dsh-mermaid-scale", fit ? "actual" : "fit");
        sizeBtn.textContent = fit ? "适应宽度" : "原尺寸";
        sizeBtn.title = fit ? "让内嵌图表适应面板宽度" : "按原始大小查看内嵌图表";
        sizeBtn.setAttribute("aria-label", sizeBtn.title);
      });
      const expandBtn = button("放大", "放大查看 Mermaid 图表", () => openViewer(wrapper));
      expandBtn.setAttribute("data-dsh-mermaid-expand", "");
      expandBtn.disabled = true;
      const rerenderBtn = button("重试", "重新渲染图表", () => {
        wrapper.removeAttribute("data-dsh-mermaid-hash");
        scheduleRender(wrapper, { force: true });
      });
      rerenderBtn.setAttribute("data-dsh-mermaid-retry", "");

      const setView = (next) => {
        wrapper.setAttribute("data-dsh-mermaid-view", next);
        if (next === "chart") {
          toggleBtn.textContent = "源码";
          toggleBtn.title = "切换到 Mermaid 源码";
          expandBtn.hidden = false;
          sizeBtn.hidden = false;
          if (nativePre) nativePre.style.display = "none";
          preview.style.display = "";
        } else {
          toggleBtn.textContent = "图表";
          toggleBtn.title = "切换到渲染图";
          expandBtn.hidden = true;
          sizeBtn.hidden = true;
          if (nativePre) nativePre.style.display = "";
          preview.style.display = "none";
        }
        toggleBtn.setAttribute("aria-label", toggleBtn.title);
      };

      toggleBtn.addEventListener("click", () => {
        const cur = wrapper.getAttribute("data-dsh-mermaid-view");
        setView(cur === "chart" ? "source" : "chart");
      });

      if (actionArea) {
        // Insert before the copy button so ours appear on the left of it.
        actionArea.insertBefore(rerenderBtn, actionArea.firstChild);
        actionArea.insertBefore(expandBtn, rerenderBtn);
        actionArea.insertBefore(sizeBtn, expandBtn);
        actionArea.insertBefore(toggleBtn, sizeBtn);
      }

      // Preview container rendered below the banner. In chart view we show
      // this and hide the <pre>; in source view the opposite.
      const preview = document.createElement("div");
      preview.className = "dsh-mermaid-preview";
      preview.tabIndex = 0;
      preview.setAttribute("role", "region");
      preview.setAttribute("aria-label", "Mermaid 图表，可滚动或放大查看");
      const stage = document.createElement("div");
      stage.className = "dsh-mermaid-stage";
      preview.appendChild(stage);
      const err = document.createElement("div");
      err.className = "dsh-mermaid-error";
      err.setAttribute("role", "status");
      err.hidden = true;
      preview.appendChild(err);

      if (nativePre) {
        nativePre.setAttribute("data-dsh-mermaid-role", "source");
        nativePre.parentNode.insertBefore(preview, nativePre.nextSibling);
      } else {
        wrapper.appendChild(preview);
      }

      // Start in chart view: hide source <pre>.
      if (nativePre) nativePre.style.display = "none";
    }

    function setError(wrapper, message) {
      const err = wrapper.querySelector(".dsh-mermaid-error");
      wrapper.setAttribute("data-dsh-mermaid-state", message ? "error" : "ok");
      const expandBtn = wrapper.querySelector("[data-dsh-mermaid-expand]");
      if (expandBtn) expandBtn.disabled = !wrapper.querySelector(".dsh-mermaid-stage svg") &&
        viewer?.wrapper !== wrapper;
      if (!err) return;
      if (message) {
        err.hidden = false;
        err.textContent = "Mermaid 渲染失败：" + message;
      } else {
        err.hidden = true;
        err.textContent = "";
      }
    }

    // ── Rendering ──────────────────────────────────────────────────────────
    async function renderOne(wrapper) {
      const codeEl = findCodeEl(wrapper);
      if (!codeEl) return;
      const source = codeEl.textContent ?? "";
      if (source.trim() === "") return;

      const theme = currentTheme();
      const hash = hashString(source + "::" + theme);
      if (wrapper.getAttribute("data-dsh-mermaid-hash") === hash) {
        setError(wrapper, "");
        return;
      }
      const isCurrent = () => wrapper.isConnected && findCodeEl(wrapper)?.textContent === source &&
        currentTheme() === theme;

      wrapper.setAttribute("data-dsh-mermaid-state", "rendering");
      try {
        const mermaid = await loadMermaid();
        if (!isCurrent()) return;
        mermaid.initialize(renderConfig(theme));
        const id = "dsh-mermaid-" + hash + "-" + Math.random().toString(36).slice(2, 8);
        const { svg, bindFunctions } = await mermaid.render(id, source);
        if (!isCurrent()) return;
        const stage = viewer?.wrapper === wrapper ? viewer.stage : wrapper.querySelector(".dsh-mermaid-stage");
        if (stage) {
          stage.innerHTML = svg;
          const chart = stage.querySelector("svg");
          if (chart) {
            if (viewer?.wrapper === wrapper) sizeChart(chart);
            else sizeInlineChart(chart);
          }
          bindFunctions?.(stage);
          if (viewer?.wrapper === wrapper) viewer.refresh();
        }
        wrapper.setAttribute("data-dsh-mermaid-hash", hash);
        setError(wrapper, "");
      } catch (e) {
        if (isCurrent()) setError(wrapper, e?.message ?? String(e));
      }
    }

    // Debounce per-wrapper so streaming token appends don't thrash mermaid.
    const pending = new WeakMap();
    let renderQueue = Promise.resolve();
    function scheduleRender(wrapper, opts) {
      const existing = pending.get(wrapper);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        pending.delete(wrapper);
        // Mermaid configuration is global; serialize initialize + render together.
        renderQueue = renderQueue.then(() => renderOne(wrapper)).catch((error) => {
          console.error("dsh-plugin-mermaid:", error);
        });
      }, opts?.force ? 0 : RENDER_DEBOUNCE_MS);
      pending.set(wrapper, t);
    }

    function scan(root) {
      const scope = root instanceof Element ? root : document;
      const blocks = scope.querySelectorAll(".md-code-block");
      blocks.forEach((wrapper) => {
        if (!isMermaidBlock(wrapper)) return;
        const code = findCodeEl(wrapper);
        if (!code) return;
        if (!wrapper.hasAttribute("data-dsh-mermaid")) {
          buildViews(wrapper, code);
        }
        scheduleRender(wrapper);
      });
    }

    // ── Theme change handling ──────────────────────────────────────────────
    // ui-layout mutates body[data-ds-dark-theme]; observe attribute flips and
    // re-render all existing blocks with the new theme.
    function observeTheme() {
      const mo = new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === "attributes" && r.attributeName === "data-ds-dark-theme") {
            document.querySelectorAll('.md-code-block[data-dsh-mermaid="ready"]').forEach((w) => {
              w.removeAttribute("data-dsh-mermaid-hash");
              scheduleRender(w, { force: true });
            });
            break;
          }
        }
      });
      mo.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
    }

    // ── DOM observation for new/streaming blocks ───────────────────────────
    let scanScheduled = false;
    function scheduleScan() {
      if (scanScheduled) return;
      scanScheduled = true;
      queueMicrotask(() => {
        scanScheduled = false;
        scan(document);
      });
    }

    function observeDom() {
      const mo = new MutationObserver((mutations) => {
        if (viewer && !viewer.wrapper.isConnected) {
          document.querySelector(".dsh-mermaid-viewer")?.close();
        }
        let needScan = false;
        for (const m of mutations) {
          const target = m.target instanceof Element ? m.target : m.target.parentElement;
          if (target?.closest(".dsh-mermaid-preview, .dsh-mermaid-viewer")) continue;
          const host = target?.closest(".md-code-block");
          if (host) {
            if (!host.hasAttribute("data-dsh-mermaid")) needScan = true;
            else if (target.closest("pre")) scheduleRender(host);
          }
          if (m.type === "childList") {
            for (const node of m.addedNodes) {
              if (node instanceof Element && (node.matches(".md-code-block") ||
                  node.querySelector(".md-code-block"))) needScan = true;
            }
          }
        }
        if (needScan) scheduleScan();
      });
      mo.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    // ── Styles (injected once) ─────────────────────────────────────────────
    const CSS = `
      .md-code-block[data-dsh-mermaid], .dsh-mermaid-viewer {
        color-scheme: light;
        --mermaid-surface: #ffffff;
        --mermaid-toolbar: #fafbfa;
        --mermaid-border: #e4e9e6;
        --mermaid-text: #242b28;
        --mermaid-muted: #66736c;
        --mermaid-hover: #eef2ef;
        --mermaid-focus: #428568;
      }
      body[data-ds-dark-theme] .md-code-block[data-dsh-mermaid],
      body[data-ds-dark-theme] .dsh-mermaid-viewer {
        color-scheme: dark;
        --mermaid-surface: #1c201e;
        --mermaid-toolbar: #202622;
        --mermaid-border: #39423c;
        --mermaid-text: #e4e7e5;
        --mermaid-muted: #a0aaa5;
        --mermaid-hover: #303a33;
        --mermaid-focus: #85b69d;
      }
      .md-code-block[data-dsh-mermaid] {
        border: 1px solid var(--mermaid-border);
        border-radius: 14px;
        overflow: hidden;
        background: var(--mermaid-surface);
      }
      .md-code-block[data-dsh-mermaid] [data-code-block-banner] {
        box-sizing: border-box;
        min-height: 44px;
        background: var(--mermaid-toolbar);
        border-bottom: 1px solid var(--mermaid-border);
        color: var(--mermaid-muted);
      }
      .md-code-block[data-dsh-mermaid] .dsh-mermaid-preview {
        padding: 16px;
        background: var(--mermaid-surface);
        overflow: auto;
        scrollbar-width: thin;
      }
      .md-code-block[data-dsh-mermaid] .dsh-mermaid-stage {
        width: 100%;
        min-height: 64px;
      }
      .md-code-block[data-dsh-mermaid] .dsh-mermaid-stage svg {
        margin-inline: auto;
        max-width: 100%;
      }
      .md-code-block[data-dsh-mermaid][data-dsh-mermaid-scale="actual"] .dsh-mermaid-stage svg {
        max-width: none;
      }
      .dsh-mermaid-viewer .dsh-mermaid-stage {
        display: grid;
        place-items: center;
        width: max-content;
        min-width: 100%;
        min-height: 64px;
      }
      .md-code-block[data-dsh-mermaid] .dsh-mermaid-stage svg,
      .dsh-mermaid-viewer .dsh-mermaid-stage svg {
        display: block;
      }
      .md-code-block[data-dsh-mermaid] .dsh-mermaid-error {
        max-width: 64ch;
        margin: 12px auto 0;
        padding: 8px 10px;
        border-radius: 6px;
        background: rgba(220, 50, 50, 0.08);
        border: 1px solid rgba(220, 50, 50, 0.3);
        color: #c93b3b;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .md-code-block[data-dsh-mermaid][data-dsh-mermaid-state="rendering"] .dsh-mermaid-stage:empty::before {
        content: "渲染中…";
        color: var(--mermaid-muted);
        font-size: 12px;
      }
      .md-code-block[data-dsh-mermaid] .dsh-mermaid-btn,
      .dsh-mermaid-viewer .dsh-mermaid-btn {
        appearance: none;
        background: transparent;
        border: 0;
        color: var(--mermaid-muted);
        font: inherit;
        font-size: 12px;
        line-height: 1;
        min-height: 28px;
        padding: 6px 9px;
        border-radius: 6px;
        cursor: pointer;
      }
      .md-code-block[data-dsh-mermaid] .dsh-mermaid-btn:hover,
      .dsh-mermaid-viewer .dsh-mermaid-btn:hover {
        color: var(--mermaid-text);
        background: var(--mermaid-hover);
      }
      .md-code-block[data-dsh-mermaid] .dsh-mermaid-btn:disabled {
        opacity: 0.4;
        cursor: default;
      }
      .md-code-block[data-dsh-mermaid] .dsh-mermaid-btn[hidden],
      .md-code-block[data-dsh-mermaid]:not([data-dsh-mermaid-state="error"]) [data-dsh-mermaid-retry] {
        display: none;
      }
      .md-code-block[data-dsh-mermaid] :focus-visible,
      .dsh-mermaid-viewer :focus-visible {
        outline: 2px solid var(--mermaid-focus);
        outline-offset: -2px;
      }
      .dsh-mermaid-viewer {
        box-sizing: border-box;
        width: min(1200px, calc(100vw - 48px));
        height: min(860px, 88dvh);
        max-width: none;
        max-height: none;
        padding: 0;
        border: 1px solid var(--mermaid-border);
        border-radius: 16px;
        background: var(--mermaid-surface);
        color: var(--mermaid-text);
        box-shadow: 0 24px 100px #00000030;
        overflow: hidden;
      }
      .dsh-mermaid-viewer[open] {
        display: flex;
        flex-direction: column;
      }
      .dsh-mermaid-viewer::backdrop {
        background: #101a1466;
        backdrop-filter: blur(4px);
      }
      .dsh-mermaid-viewer-toolbar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 4px;
        padding: 12px 16px;
        border-bottom: 1px solid var(--mermaid-border);
        background: var(--mermaid-toolbar);
      }
      .dsh-mermaid-viewer-toolbar strong {
        margin-right: auto;
        font-size: 14px;
        font-weight: 600;
      }
      .dsh-mermaid-viewer-toolbar output {
        min-width: 44px;
        text-align: center;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        color: var(--mermaid-muted);
      }
      .dsh-mermaid-viewport {
        flex: 1;
        min-height: 0;
        overflow: auto;
        overscroll-behavior: contain;
        cursor: grab;
      }
      .dsh-mermaid-viewport.is-dragging {
        cursor: grabbing;
        user-select: none;
      }
      .dsh-mermaid-viewport .dsh-mermaid-stage {
        box-sizing: border-box;
        padding: 24px;
        min-height: 100%;
      }
      .dsh-mermaid-viewer-hint {
        padding: 10px 16px;
        border-top: 1px solid var(--mermaid-border);
        color: var(--mermaid-muted);
        text-align: center;
        font-size: 12px;
      }
      @media (max-width: 600px) {
        .md-code-block[data-dsh-mermaid] .dsh-mermaid-preview { padding: 12px; }
        .dsh-mermaid-viewer {
          width: calc(100vw - 16px);
          height: 94dvh;
          border-radius: 12px;
        }
        .dsh-mermaid-viewer-toolbar { padding: 8px; }
        .dsh-mermaid-viewer-toolbar strong { display: none; }
      }
    `;
    function injectStyles() {
      if (document.getElementById("dsh-plugin-mermaid-styles")) return;
      const style = document.createElement("style");
      style.id = "dsh-plugin-mermaid-styles";
      style.setAttribute("data-plugin", PLUGIN_ID);
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    // ── Cordis plugin face ─────────────────────────────────────────────────
    const name = PLUGIN_ID;
    const inject = [];
    function apply(ctx) {
      ctx.logger?.info?.("dsh-plugin-mermaid: client apply");
      injectStyles();
      // Wait for <body> so the MutationObserver target exists.
      const start = () => {
        scan(document);
        observeDom();
        observeTheme();
      };
      if (document.body) start();
      else document.addEventListener("DOMContentLoaded", start, { once: true });
      ctx.effect?.(() => () => {
        // No teardown needed; page reload owns lifecycle.
      });
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});

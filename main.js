/* Pencil Zones v0.5.0 — plain-JS Obsidian plugin (no build step).
 *
 * - Command "Insert drawing zone" creates a resizable inline canvas.
 * - Strokes saved as standalone SVG in a configurable root folder.
 * - Canvas background is transparent: the Obsidian light/dark theme shows
 *   through, live and (via prefers-color-scheme) in static embeds too.
 * - Ink color "dynamic": black on light theme, white on dark theme.
 * - ONE global toolbar: bottom-right by default, moved by finger
 *   touch-and-slide anywhere on its background; snaps to the nearest
 *   side (left/right) on release. Two columns (colors | tools). Only
 *   shown when the current note has a drawing zone.
 * - Only pen + mouse draw. Fingers never draw.
 * - Single tap with 2 fingers = undo, single tap with 3 fingers = redo,
 *   via document-level Touch Events. Plus "Undo stroke" / "Redo stroke".
 * - Long-press (finger) a zone to move it before/after other content: a
 *   blinking text-cursor previews the landing spot while dragging.
 * - Tools: pencil, highlighter, object eraser, pixel eraser.
 * - Widths hardcoded: pencil 2, highlighter 28 @ 0.35, no width selector.
 * - Optional ruled lines per zone (toggle in toolbar, persisted).
 */

const { Plugin, PluginSettingTab, Setting, MarkdownView } = require("obsidian");

const CODE_LANG = "pencil-draw";
const CANVAS_W = 800;

const DYNAMIC_INK = "dynamic";

const COLORS = [
  { dynamic: true, name: "ink (auto black/white)" },
  { hex: "#FFD400", name: "yellow" },
  { hex: "#E53935", name: "red" },
  { hex: "#43A047", name: "green" },
  { hex: "#1E88E5", name: "blue" },
];

// Hardcoded widths (no UI selector per spec)
const WIDTH_PENCIL = 2;
const WIDTH_HIGHLIGHT = 28;
const OPACITY_HIGHLIGHT = 0.35;
const ERASER_RADIUS = 14; // svg units hit-test radius (object eraser)
const PIXEL_ERASER_RADIUS = 10; // svg units radius (pixel eraser)
const LINE_SPACING = 32;

// 2/3-finger tap gesture tuning
const TAP_MAX_MS = 800;
const TAP_MAX_MOVE = 30; // px per finger, compared against its OWN start pos

// Long-press-to-move tuning
const MOVE_PRESS_MS = 600;
const MOVE_TOL = 12; // px finger may wander during the hold

const DEFAULT_SETTINGS = {
  svgFolder: "_inline_handwriting",
  defaultHeight: 300,
  defaultLines: false,
  dockSide: "right", // "left" | "right": toolbar snaps to sides only
  dockYFrac: null, // 0..1 fraction of viewport height; null = bottom default
  verboseLog: false, // console.log input diagnostics (buffer always records)
};

function pad2(n) {
  return String(n).padStart(2, "0");
}

function timestamp() {
  const d = new Date();
  return (
    d.getFullYear().toString() +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds())
  );
}

function rand4() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function sanitizeBase(name) {
  return (name || "Note").replace(/[\\/:*?"<>|#^\[\]]/g, "-").slice(0, 60) || "Note";
}

function parseCodeSource(source) {
  const out = {};
  for (const line of source.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_]+)\s*:\s*(.+?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function parseLinesFlag(v) {
  if (v == null) return false;
  return /^(true|1|yes|on)$/i.test(String(v).trim());
}

function isDynamicColor(c) {
  return !c || c === DYNAMIC_INK;
}

function isBlackHex(c) {
  return typeof c === "string" && /^#0{3}([0]{3})?$/i.test(c.trim());
}

function strokeWidthFor(stroke) {
  if (stroke.tool === "highlighter") return WIDTH_HIGHLIGHT;
  return WIDTH_PENCIL;
}

function strokeOpacityFor(stroke) {
  if (stroke.tool === "highlighter") return OPACITY_HIGHLIGHT;
  return 1;
}

function pathD(points) {
  if (!points || points.length === 0) return "";
  if (points.length === 1) {
    const p = points[0];
    // tiny dot so single taps render
    return `M ${p.x.toFixed(1)},${p.y.toFixed(1)} L ${(p.x + 0.1).toFixed(1)},${(p.y + 0.1).toFixed(1)}`;
  }
  let d = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) d += ` L ${points[i].x.toFixed(1)},${points[i].y.toFixed(1)}`;
  return d;
}

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function linesSVG(w, h) {
  let s = "";
  for (let y = LINE_SPACING; y < h; y += LINE_SPACING) {
    s += `  <line class="pz-rule" x1="0" y1="${y}" x2="${w}" y2="${y}" stroke-width="1"/>\n`;
  }
  return s;
}

// Transparent background: the app theme shows through. Dynamic ink + ruled
// lines adapt via an embedded <style> (also works in static image embeds).
function themedStyleBlock() {
  return (
    `  <style>.pz-ink{stroke:#000000}.pz-rule{stroke:#e4e4e4}` +
    `@media (prefers-color-scheme:dark){.pz-ink{stroke:#ffffff}.pz-rule{stroke:#3a3a3f}}</style>\n`
  );
}

function buildSVG(strokes, w, h, showLines) {
  const paths = strokes
    .map((s) => {
      const d = pathD(s.points);
      if (!d) return "";
      const width = strokeWidthFor(s);
      const opacity = strokeOpacityFor(s);
      const colorAttr = isDynamicColor(s.color) ? ` class="pz-ink"` : ` stroke="${s.color}"`;
      return `  <path d="${d}"${colorAttr} fill="none" stroke-width="${width}" stroke-opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join("\n");
  const needsTheme = showLines || strokes.some((s) => isDynamicColor(s.color));
  const data = JSON.stringify({ version: 2, width: w, lines: !!showLines, strokes });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n` +
    (needsTheme ? themedStyleBlock() : "") +
    (showLines ? linesSVG(w, h) : "") +
    (paths ? paths + "\n" : "") +
    `  <desc id="pz-data">${escapeXml(data)}</desc>\n</svg>\n`
  );
}

function extractData(svgText) {
  const fallback = { strokes: [], lines: false };
  if (!svgText) return fallback;
  const m = svgText.match(/<desc id="pz-data">(.*?)<\/desc>/s);
  if (!m) return fallback;
  try {
    const json = m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const data = JSON.parse(json);
    const strokes = Array.isArray(data) ? data : Array.isArray(data.strokes) ? data.strokes : [];
    const lines = !Array.isArray(data) && !!data.lines;
    return { strokes: strokes.filter((s) => s && Array.isArray(s.points)), lines };
  } catch (e) {
    return fallback;
  }
}

// Split source lines into top-level blocks the way the preview renderer
// groups them (blank-line separated; fences + frontmatter stay whole).
// Frontmatter is flagged meta: it is NOT a rendered block.
function splitBlocks(lines) {
  const blocks = [];
  const push = (b) => {
    if (b) blocks.push(b);
  };
  let cur = null;
  let i = 0;
  if (lines.length && lines[0] === "---") {
    let j = 1;
    while (j < lines.length && lines[j] !== "---" && lines[j] !== "...") j++;
    if (j < lines.length) {
      blocks.push({ start: 0, end: j, meta: true });
      i = j + 1;
    }
  }
  let inFence = false;
  for (; i < lines.length; i++) {
    const ln = lines[i];
    if (/^\s*(```|~~~)/.test(ln)) {
      if (!inFence) {
        push(cur);
        cur = null;
        cur = { start: i, end: i };
        inFence = true;
      } else {
        cur.end = i;
        push(cur);
        cur = null;
        inFence = false;
      }
      continue;
    }
    if (inFence) {
      cur.end = i;
      continue;
    }
    if (/^\s*$/.test(ln)) {
      push(cur);
      cur = null;
      continue;
    }
    if (!cur) cur = { start: i, end: i };
    else cur.end = i;
  }
  push(cur);
  return blocks;
}

function lineStartsOf(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

class PencilZonesPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    // Global state: one toolbar controls every zone.
    this.tool = "pencil";
    this.color = DYNAMIC_INK;
    this.entries = new Map(); // src -> {strokes, undo, redo, height, lines, views, saveTimer, loadStarted}
    this.activeSrc = null;
    this.typingHidden = false;
    this.moveMode = null;
    this.diag = [];

    this.addSettingTab(new PencilZonesSettingTab(this.app, this));

    this.addCommand({
      id: "insert-drawing-zone",
      name: "Insert drawing zone",
      editorCallback: (editor, view) => {
        this.insertDrawingZone(editor, view);
      },
    });
    this.addCommand({
      id: "undo-stroke",
      name: "Undo stroke",
      callback: () => this.doUndo(),
    });
    this.addCommand({
      id: "redo-stroke",
      name: "Redo stroke",
      callback: () => this.doRedo(),
    });
    this.addCommand({
      id: "copy-diagnostics",
      name: "Copy input diagnostics",
      callback: async () => {
        const text =
          "Pencil Zones diagnostics\nentries=" +
          this.entries.size +
          " active=" +
          this.activeSrc +
          "\n" +
          this.diag.join("\n");
        try {
          if (typeof navigator !== "undefined" && navigator.clipboard) {
            await navigator.clipboard.writeText(text);
          }
        } catch (e) {
          console.warn("[PZ] clipboard copy failed", e);
        }
      },
    });

    this.registerMarkdownCodeBlockProcessor(CODE_LANG, (source, el, ctx) => {
      this.renderZone(source, el, ctx);
    });

    this.buildGlobalToolbar();
    this.buildDropCursor();
    this.trackFingerGestures();
    this.setupMoveMode();

    // Hide the global toolbar when the user starts typing via keyboard.
    this.registerDomEvent(document, "keydown", (e) => {
      if (e.key.length !== 1 && e.key !== "Backspace" && e.key !== "Enter") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const ae = document.activeElement;
      if (!ae) return;
      const tag = (ae.tagName || "").toLowerCase();
      const editable =
        tag === "textarea" ||
        tag === "input" ||
        ae.isContentEditable ||
        (ae.closest ? !!ae.closest(".cm-content") : false);
      if (!editable) return;
      this.hideToolbar();
    });

    // Re-evaluate toolbar visibility when notes change or re-render.
    const refresh = () => this.updateToolbarVisibility();
    this.registerEvent(this.app.workspace.on("file-open", refresh));
    this.registerEvent(this.app.workspace.on("active-leaf-change", refresh));
    this.registerEvent(this.app.workspace.on("layout-change", refresh));
    let moTimer = null;
    const mo = new MutationObserver(() => {
      if (moTimer) clearTimeout(moTimer);
      moTimer = setTimeout(refresh, 200);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    this.register(() => {
      if (moTimer) clearTimeout(moTimer);
      mo.disconnect();
    });

    if (typeof window !== "undefined" && window.addEventListener) {
      const onResize = () => this.applyDock();
      window.addEventListener("resize", onResize, { passive: true });
      this.register(() => window.removeEventListener("resize", onResize));
    }

    this.updateToolbarVisibility();
  }

  onunload() {
    this.cancelMove();
    if (this.toolbarEl && this.toolbarEl.parentNode) {
      this.toolbarEl.parentNode.removeChild(this.toolbarEl);
    }
    this.toolbarEl = null;
    if (this.dropCursor && this.dropCursor.parentNode) {
      this.dropCursor.parentNode.removeChild(this.dropCursor);
    }
    this.dropCursor = null;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // Always-on input diagnostics ring buffer (cheap). "Copy input
  // diagnostics" command dumps it for remote debugging.
  dlog(tag, msg) {
    try {
      this.diag.push(new Date().toISOString().slice(11, 23) + " " + tag + (msg ? " " + msg : ""));
      if (this.diag.length > 120) this.diag.splice(0, this.diag.length - 120);
      if (this.settings && this.settings.verboseLog) console.log("[PZ]", tag, msg || "");
    } catch (_) {}
  }

  svgPath(src) {
    return (src || "").replace(/^\//, "");
  }

  activeFile() {
    try {
      return this.app.workspace.getActiveFile();
    } catch (_) {
      return null;
    }
  }

  activeMarkdownView() {
    try {
      return this.app.workspace.getActiveViewOfType(MarkdownView);
    } catch (_) {
      return null;
    }
  }

  getViewMode() {
    try {
      const v = this.activeMarkdownView();
      if (v && typeof v.getMode === "function") return v.getMode();
    } catch (_) {}
    return "source";
  }

  async ensureFolder() {
    const folder = (this.settings.svgFolder || "_inline_handwriting").replace(/^\//, "").replace(/\/$/, "");
    if (!folder) return "";
    try {
      const exists = await this.app.vault.adapter.exists(folder);
      if (!exists) await this.app.vault.createFolder(folder);
    } catch (e) {
      console.warn("Pencil Zones: could not ensure folder", e);
    }
    return folder;
  }

  async insertDrawingZone(editor, view) {
    const folder = await this.ensureFolder();
    const base = sanitizeBase(view && view.file ? view.file.basename : "Note");
    const fname = `${base}-${timestamp()}-${rand4()}.svg`;
    const rel = folder ? `${folder}/${fname}` : fname;
    const height = this.settings.defaultHeight || 300;
    const showLines = !!this.settings.defaultLines;

    try {
      const exists = await this.app.vault.adapter.exists(rel);
      if (!exists) await this.app.vault.create(rel, buildSVG([], CANVAS_W, height, showLines));
    } catch (e) {
      console.warn("Pencil Zones: could not create SVG", e);
    }

    const snippet =
      "```" + CODE_LANG + "\nsrc: " + rel + "\nheight: " + height + "\nlines: " + (showLines ? "true" : "false") + "\n```\n";
    editor.replaceSelection(snippet);
  }

  async persistBlockParams(src, patch) {
    try {
      const view = this.activeMarkdownView();
      if (!view) return;
      const editor = view.editor;
      const text = editor.getValue();
      const idx = text.indexOf("src: " + src);
      if (idx === -1) return;
      const fenceStart = text.lastIndexOf("```" + CODE_LANG, idx);
      const fenceEnd = text.indexOf("```", idx);
      if (fenceStart === -1 || fenceEnd === -1) return;
      let block = text.slice(fenceStart, fenceEnd);
      if (patch.height != null) {
        const h = "height: " + Math.round(patch.height);
        block = /^height\s*:/m.test(block)
          ? block.replace(/^height\s*:.*$/m, h)
          : block.replace(/^(src\s*:.*)$/m, "$1\n" + h);
      }
      if (patch.lines != null) {
        const l = "lines: " + (patch.lines ? "true" : "false");
        block = /^lines\s*:/m.test(block)
          ? block.replace(/^lines\s*:.*$/m, l)
          : block.replace(/^(src\s*:.*)$/m, "$1\n" + l);
      }
      editor.replaceRange(block, editor.offsetToPos(fenceStart), editor.offsetToPos(fenceEnd));
    } catch (e) {
      console.warn("Pencil Zones: could not persist block params", e);
    }
  }

  // ---------- shared entry (one per SVG file, shared by all its views) ----------

  getEntry(src, height, showLines) {
    let entry = this.entries.get(src);
    if (!entry) {
      entry = {
        src,
        strokes: [],
        undo: [],
        redo: [],
        height,
        lines: showLines,
        views: new Set(),
        saveTimer: null,
        loadStarted: false,
      };
      this.entries.set(src, entry);
      this.loadEntry(entry);
    } else {
      // The codeblock source is the truth for display params.
      entry.height = height;
      entry.lines = showLines;
      // Drop views whose DOM was re-rendered away.
      for (const v of entry.views) {
        if (!v.zoneEl.isConnected) entry.views.delete(v);
      }
    }
    return entry;
  }

  async loadEntry(entry) {
    if (entry.loadStarted) return;
    entry.loadStarted = true;
    try {
      const exists = await this.app.vault.adapter.exists(entry.src);
      if (!exists) return;
      const text = await this.app.vault.adapter.read(entry.src);
      const data = extractData(text);
      if (data.strokes.length) {
        // Legacy black (#000000) becomes dynamic ink: identical on light
        // theme, visible (white) on dark theme.
        for (const s of data.strokes) {
          if (isBlackHex(s.color)) s.color = DYNAMIC_INK;
        }
        entry.strokes = data.strokes;
        this.renderEntryViews(entry);
      }
    } catch (e) {
      console.warn("Pencil Zones: load failed", e);
    }
  }

  renderEntryViews(entry) {
    for (const v of entry.views) {
      if (v.zoneEl.isConnected) v.render();
      else entry.views.delete(v);
    }
  }

  firstConnectedEntry() {
    for (const entry of this.entries.values()) {
      for (const v of entry.views) {
        if (v.zoneEl.isConnected) return entry;
      }
    }
    return null;
  }

  firstConnectedView(entry) {
    if (!entry) return null;
    for (const v of entry.views) {
      if (v.zoneEl.isConnected) return v;
    }
    return null;
  }

  scheduleSave(entry) {
    if (entry.saveTimer) clearTimeout(entry.saveTimer);
    entry.saveTimer = setTimeout(() => this.saveEntry(entry), 600);
  }

  async saveEntry(entry) {
    if (entry.saveTimer) {
      clearTimeout(entry.saveTimer);
      entry.saveTimer = null;
    }
    try {
      const text = buildSVG(entry.strokes, CANVAS_W, Math.round(entry.height), entry.lines);
      const adapter = this.app.vault.adapter;
      const exists = await adapter.exists(entry.src);
      if (exists) await adapter.write(entry.src, text);
      else await this.app.vault.create(entry.src, text);
    } catch (e) {
      console.warn("Pencil Zones: save failed", e);
    }
  }

  pushUndo(entry) {
    entry.undo.push(JSON.parse(JSON.stringify(entry.strokes)));
    if (entry.undo.length > 100) entry.undo.shift();
  }

  activeEntry() {
    if (this.activeSrc && this.entries.has(this.activeSrc)) return this.entries.get(this.activeSrc);
    if (this.entries.size === 1) {
      const only = this.entries.values().next().value;
      this.activeSrc = only.src;
      this.refreshActiveOutlines();
      this.refreshToolbar();
      return only;
    }
    return this.firstConnectedEntry();
  }

  doUndo() {
    const entry = this.activeEntry();
    if (!entry) return;
    this.setActive(entry.src);
    if (entry.undo.length === 0) return;
    entry.redo.push(JSON.parse(JSON.stringify(entry.strokes)));
    entry.strokes = entry.undo.pop();
    this.renderEntryViews(entry);
    this.scheduleSave(entry);
  }

  doRedo() {
    const entry = this.activeEntry();
    if (!entry) return;
    this.setActive(entry.src);
    if (entry.redo.length === 0) return;
    entry.undo.push(JSON.parse(JSON.stringify(entry.strokes)));
    entry.strokes = entry.redo.pop();
    this.renderEntryViews(entry);
    this.scheduleSave(entry);
  }

  toggleLinesActive() {
    const entry = this.activeEntry();
    if (!entry) return;
    entry.lines = !entry.lines;
    this.renderEntryViews(entry);
    this.scheduleSave(entry);
    this.refreshToolbar();
    this.persistBlockParams(entry.src, { lines: entry.lines });
  }

  cancelAllStrokes() {
    for (const entry of this.entries.values()) {
      for (const v of entry.views) {
        try {
          if (v.zoneEl.isConnected && v.cancelStroke) v.cancelStroke();
        } catch (_) {}
      }
    }
  }

  setActive(src) {
    if (this.activeSrc !== src) {
      this.activeSrc = src;
      this.refreshActiveOutlines();
      this.refreshToolbar();
    }
  }

  refreshActiveOutlines() {
    for (const entry of this.entries.values()) {
      for (const v of entry.views) {
        if (v.zoneEl.isConnected) v.zoneEl.classList.toggle("pz-active", entry.src === this.activeSrc);
      }
    }
  }

  // ---------- 2-finger undo / 3-finger redo (document-level Touch Events) ----------

  trackFingerGestures() {
    const map = new Map(); // identifier -> {sx, sy, x, y}
    let session = null; // {ids:Set, start, moved}

    const onStart = (e) => {
      if (this.moveMode || !e.changedTouches) return;
      for (const t of Array.from(e.changedTouches)) {
        map.set(t.identifier, { sx: t.clientX, sy: t.clientY, x: t.clientX, y: t.clientY });
        if (!session) session = { ids: new Set(), start: Date.now(), moved: false };
        session.ids.add(t.identifier);
      }
      // Multi-touch cancels any in-progress stroke so gestures never draw.
      if (map.size >= 2) {
        this.dlog("gesture-multitouch", "touches=" + map.size);
        this.cancelAllStrokes();
      }
    };

    const onMove = (e) => {
      if (this.moveMode || !session || !e.changedTouches) return;
      for (const t of Array.from(e.changedTouches)) {
        const m = map.get(t.identifier);
        if (!m) continue;
        m.x = t.clientX;
        m.y = t.clientY;
        if (!session.moved) {
          const dx = m.x - m.sx;
          const dy = m.y - m.sy;
          if (dx * dx + dy * dy > TAP_MAX_MOVE * TAP_MAX_MOVE) session.moved = true;
        }
      }
    };

    const onEnd = (e, isCancel) => {
      if (!e.changedTouches) return;
      for (const t of Array.from(e.changedTouches)) map.delete(t.identifier);
      if (isCancel) {
        if (map.size === 0) session = null;
        return;
      }
      if (this.moveMode) {
        session = null;
        return;
      }
      const remaining = e.touches ? e.touches.length : map.size;
      if (remaining !== 0 || !session) return;
      const s = session;
      session = null;
      const dt = Date.now() - s.start;
      const n = s.ids.size;
      if (s.moved || dt > TAP_MAX_MS || (n !== 2 && n !== 3)) {
        this.dlog("gesture-reject", "n=" + n + " dt=" + dt + " moved=" + s.moved);
        return;
      }
      // Prefer the zone under the lift point; fall back to a visible zone.
      let src = null;
      try {
        const last = Array.from(e.changedTouches).pop();
        const hit = last ? document.elementFromPoint(last.clientX, last.clientY) : null;
        const zoneEl = hit && hit.closest ? hit.closest(".pz-zone") : null;
        if (zoneEl && zoneEl.dataset && zoneEl.dataset.src) src = zoneEl.dataset.src;
      } catch (_) {}
      if (src && this.entries.has(src)) this.setActive(src);
      else {
        const fb = this.firstConnectedEntry();
        if (fb) this.setActive(fb.src);
      }
      this.dlog("gesture-fire", (n === 2 ? "undo" : "redo") + " src=" + (this.activeSrc || "?"));
      if (n === 2) this.doUndo();
      else this.doRedo();
    };

    const endFn = (e) => onEnd(e, false);
    const cancelFn = (e) => onEnd(e, true);
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", endFn, { passive: true });
    document.addEventListener("touchcancel", cancelFn, { passive: true });
    this.register(() => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", endFn);
      document.removeEventListener("touchcancel", cancelFn);
    });
  }

  // ---------- global toolbar (draggable, snaps to left/right sides) ----------

  showToolbar() {
    this.typingHidden = false;
    this.updateToolbarVisibility();
  }

  hideToolbar() {
    this.typingHidden = true;
    this.updateToolbarVisibility();
  }

  updateToolbarVisibility() {
    if (!this.toolbarEl) return;
    let has = false;
    try {
      const view = this.activeMarkdownView();
      has = !!(view && view.containerEl && view.containerEl.querySelector(".pz-zone"));
    } catch (_) {
      has = false;
    }
    this.toolbarEl.classList.toggle("pz-hidden", !(has && !this.typingHidden));
    this.applyDock();
  }

  dockMetrics() {
    const bar = this.toolbarEl;
    if (!bar) return null;
    const w = bar.offsetWidth || 0;
    const h = bar.offsetHeight || 0;
    if (!w || !h) return null;
    // Dock area = the active pane's content rect, so the panel can never
    // leave the note and slide over side panels (file explorer, etc.).
    const vw = (typeof window !== "undefined" && window.innerWidth) || 1024;
    const vh = (typeof window !== "undefined" && window.innerHeight) || 768;
    let area = { left: 0, top: 0, right: vw, bottom: vh };
    try {
      const view = this.activeMarkdownView();
      const cel = view && view.containerEl;
      if (cel && typeof cel.getBoundingClientRect === "function") {
        const r = cel.getBoundingClientRect();
        if (r && r.width > 60 && r.height > 60) {
          area = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        }
      }
    } catch (_) {}
    return { w, h, vw, vh, area };
  }

  // Position from saved dock (side + vertical fraction), clamped to the
  // active pane's content area. The panel lives on the left or right side
  // only — never floating mid-screen, never over side panels.
  applyDock() {
    const bar = this.toolbarEl;
    if (!bar || bar.classList.contains("pz-hidden")) return;
    const m = this.dockMetrics();
    if (!m) return;
    const side = this.settings.dockSide === "left" ? "left" : "right";
    let yFrac = this.settings.dockYFrac;
    let top;
    if (typeof yFrac !== "number" || !Number.isFinite(yFrac)) {
      top = m.area.bottom - m.h - 18; // bottom-right by default
    } else {
      top = Math.min(1, Math.max(0, yFrac)) * m.vh;
    }
    top = Math.max(m.area.top + 8, Math.min(top, Math.max(m.area.top + 8, m.area.bottom - m.h - 8)));
    const left =
      side === "left"
        ? m.area.left + 8
        : Math.max(m.area.left + 8, m.area.right - m.w - 8);
    bar.style.left = Math.round(left) + "px";
    bar.style.top = Math.round(top) + "px";
    bar.style.right = "auto";
    bar.style.bottom = "auto";
  }

  async saveDock(side, topPx) {
    this.settings.dockSide = side;
    try {
      const vh = (typeof window !== "undefined" && window.innerHeight) || 768;
      this.settings.dockYFrac = vh > 0 ? Math.min(1, Math.max(0, topPx / vh)) : null;
    } catch (_) {
      this.settings.dockYFrac = null;
    }
    await this.saveSettings();
  }

  refreshToolbar() {
    if (!this.toolbarEl) return;
    for (const [tool, btn] of Object.entries(this.toolBtns || {})) {
      btn.classList.toggle("pz-active", this.tool === tool);
    }
    for (const item of this.colorBtns || []) {
      item.btn.classList.toggle("pz-active", this.color === item.key);
    }
    const entry = this.activeSrc ? this.entries.get(this.activeSrc) : null;
    if (this.linesBtn) this.linesBtn.classList.toggle("pz-active", !!(entry && entry.lines));
  }

  buildGlobalToolbar() {
    const plugin = this;
    const bar = document.body.createDiv({ cls: "pz-global" });
    this.toolbarEl = bar;
    this.register(() => {
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    });

    // Panel drag: any FINGER touch-and-slide on the panel background moves
    // it (buttons handle their own taps). Release snaps to a side.
    // Sliding toward a side docks there (like the iPadOS drawing toolbar):
    // fling direction wins, otherwise the nearest side wins.
    let barTouch = null; // {id, sx, sy, dx, dy, samples, dragging}
    let barSuppressClick = false;
    const BAR_DRAG_TOL = 8; // px before a touch becomes a drag
    bar.addEventListener(
      "click",
      (e) => {
        if (barSuppressClick) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true
    );
    bar.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") return;
      if (e.target && e.target.closest && e.target.closest(".pz-btn")) return;
      if (barTouch) return; // one drag at a time
      e.preventDefault();
      e.stopPropagation();
      const r = bar.getBoundingClientRect();
      barTouch = {
        id: e.pointerId,
        sx: e.clientX,
        sy: e.clientY,
        dx: e.clientX - r.left,
        dy: e.clientY - r.top,
        samples: [{ x: e.clientX, t: Date.now() }],
        dragging: false,
      };
      try {
        bar.setPointerCapture(e.pointerId);
      } catch (_) {}
    });
    bar.addEventListener("pointermove", (e) => {
      if (!barTouch || e.pointerId !== barTouch.id) return;
      e.preventDefault();
      const now = Date.now();
      barTouch.samples.push({ x: e.clientX, t: now });
      while (barTouch.samples.length > 2 && now - barTouch.samples[0].t > 150) barTouch.samples.shift();
      if (!barTouch.dragging) {
        const ddx = e.clientX - barTouch.sx;
        const ddy = e.clientY - barTouch.sy;
        if (ddx * ddx + ddy * ddy < BAR_DRAG_TOL * BAR_DRAG_TOL) return;
        barTouch.dragging = true;
        bar.classList.remove("pz-snapping");
        barSuppressClick = true; // a drag is not a tap: swallow the click
      }
      const m = plugin.dockMetrics();
      if (!m) return;
      const left = Math.max(
        m.area.left - m.w + 40,
        Math.min(e.clientX - barTouch.dx, m.area.right - 40)
      );
      const top = Math.max(
        m.area.top + 8,
        Math.min(e.clientY - barTouch.dy, Math.max(m.area.top + 8, m.area.bottom - m.h - 8))
      );
      bar.style.left = Math.round(left) + "px";
      bar.style.top = Math.round(top) + "px";
      bar.style.right = "auto";
      bar.style.bottom = "auto";
    });
    const endBarDrag = (e) => {
      if (!barTouch || (e.pointerId !== undefined && e.pointerId !== barTouch.id)) return;
      const wasDrag = barTouch.dragging;
      const samples = barTouch.samples || [];
      barTouch = null;
      try {
        if (e.pointerId !== undefined) bar.releasePointerCapture(e.pointerId);
      } catch (_) {}
      setTimeout(() => {
        barSuppressClick = false;
      }, 300);
      if (!wasDrag) return; // plain tap: buttons already handled it
      // Direction wins over position: a leftward slide docks left even if
      // released right of center (and vice versa).
      let vx = 0;
      if (samples.length >= 2) {
        const dt = samples[samples.length - 1].t - samples[0].t;
        const dx = samples[samples.length - 1].x - samples[0].x;
        if (dt > 0) vx = dx / dt;
        else if (dx !== 0) vx = dx > 0 ? Infinity : -Infinity;
      }
      const m = plugin.dockMetrics();
      const r = bar.getBoundingClientRect();
      const mid = m ? (m.area.left + m.area.right) / 2 : 512;
      const side = vx < -0.35 ? "left" : vx > 0.35 ? "right" : r.left + r.width / 2 < mid ? "left" : "right";
      // Animate the snap; free drags stay instant.
      bar.classList.add("pz-snapping");
      setTimeout(() => bar.classList.remove("pz-snapping"), 350);
      plugin.saveDock(side, r.top).then(() => plugin.applyDock());
    };
    bar.addEventListener("pointerup", endBarDrag);
    bar.addEventListener("pointercancel", endBarDrag);
    bar.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    const body = bar.createDiv({ cls: "pz-body" });
    const colColors = body.createDiv({ cls: "pz-col" });
    const colTools = body.createDiv({ cls: "pz-col" });

    // Controls are plain divs (not <button>): taps can never steal editor
    // focus or flip a Live Preview block back into source text.
    const mkBtn = (parent, emoji, title, onTap) => {
      const b = parent.createDiv({ cls: "pz-btn" });
      b.setAttribute("role", "button");
      b.setAttribute("aria-label", title);
      b.setText(emoji);
      b.addEventListener("pointerdown", (e) => e.stopPropagation());
      b.addEventListener("mousedown", (e) => e.stopPropagation());
      b.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onTap();
      });
      b.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      return b;
    };

    this.colorBtns = [];
    for (const c of COLORS) {
      const key = c.dynamic ? DYNAMIC_INK : c.hex;
      const b = colColors.createDiv({ cls: "pz-btn" });
      b.setAttribute("role", "button");
      b.setAttribute("aria-label", c.name);
      const sw = b.createDiv({ cls: "pz-swatch" + (c.dynamic ? " pz-dynamic" : "") });
      if (!c.dynamic) sw.style.background = c.hex;
      b.addEventListener("pointerdown", (e) => e.stopPropagation());
      b.addEventListener("mousedown", (e) => e.stopPropagation());
      b.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.color = key;
        if (this.tool === "eraser" || this.tool === "pxeraser") this.tool = "pencil";
        this.refreshToolbar();
        this.showToolbar();
      });
      b.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      this.colorBtns.push({ btn: b, key });
    }

    this.toolBtns = {};
    const mkTool = (emoji, title, tool) => {
      this.toolBtns[tool] = mkBtn(colTools, emoji, title, () => {
        this.tool = tool;
        this.refreshToolbar();
        this.showToolbar();
      });
    };
    mkTool("✏️", "Pencil", "pencil");
    mkTool("🖍️", "Highlighter", "highlighter");
    mkTool("🧽", "Object eraser", "eraser");
    mkTool("🧼", "Pixel eraser", "pxeraser");
    this.linesBtn = mkBtn(colTools, "📏", "Ruled lines", () => this.toggleLinesActive());

    this.refreshToolbar();
    // First layout once dimensions exist.
    setTimeout(() => this.applyDock(), 50);
  }

  // ---------- drop cursor (text-caret landing preview) ----------

  buildDropCursor() {
    const c = document.body.createDiv({ cls: "pz-drop-cursor" });
    c.style.display = "none";
    this.dropCursor = c;
    this.register(() => {
      if (c.parentNode) c.parentNode.removeChild(c);
    });
  }

  showDropCursor(x, y, height) {
    const c = this.dropCursor;
    if (!c) return;
    c.style.display = "block";
    c.style.left = Math.round(x) + "px";
    c.style.top = Math.round(y) + "px";
    c.style.height = Math.round(height || 26) + "px";
  }

  hideDropCursor() {
    if (this.dropCursor) this.dropCursor.style.display = "none";
  }

  // Walk up to the direct child of the reading-view content sizer.
  sizerBlockOf(node) {
    let n = node;
    while (n) {
      const p = n.parentNode;
      if (p && p.classList && p.classList.contains("markdown-preview-sizer")) return { block: n, sizer: p };
      if (n === document.body || !p) return null;
      n = p;
    }
    return null;
  }

  // Walk up to find the enclosing drawing zone (stops at resize handle).
  zoneOf(node) {
    let n = node;
    while (n && n !== document.body) {
      if (n.classList) {
        if (n.classList.contains("pz-resize")) return null;
        if (n.classList.contains("pz-zone")) return n;
      }
      n = n.parentNode;
    }
    return null;
  }

  scrollableAncestor(el) {
    let n = el;
    while (n && n !== document.body) {
      try {
        const st = window.getComputedStyle(n);
        if (st && (st.overflowY === "auto" || st.overflowY === "scroll")) return n;
      } catch (_) {}
      n = n.parentNode;
    }
    return null;
  }

  // ---------- long-press (finger) to move a zone before/after content ----------

  setupMoveMode() {
    let candidate = null; // {id, x, y, timer, src, zoneEl}

    document.addEventListener(
      "touchstart",
      (e) => {
        if (this.moveMode) {
          // Second finger during a move cancels it (gestures take over).
          this.cancelMove();
          if (candidate) {
            clearTimeout(candidate.timer);
            candidate = null;
          }
          return;
        }
        if (!e.changedTouches || e.changedTouches.length === 0) return;
        const t = e.changedTouches[0];
        const target = t.target || e.target;
        const zoneEl = target ? this.zoneOf(target) : null;
        if (!zoneEl || !zoneEl.dataset || !zoneEl.dataset.src) return;
        if (candidate) clearTimeout(candidate.timer);
        const id = t.identifier;
        candidate = {
          id,
          x: t.clientX,
          y: t.clientY,
          src: zoneEl.dataset.src,
          zoneEl,
          timer: setTimeout(() => {
            if (candidate && candidate.id === id) {
              const c = candidate;
              candidate = null;
              this.startMoveMode(c);
            }
          }, MOVE_PRESS_MS),
        };
      },
      { passive: true }
    );

    document.addEventListener(
      "touchmove",
      (e) => {
        if (candidate && e.changedTouches) {
          for (const t of Array.from(e.changedTouches)) {
            if (t.identifier !== candidate.id) continue;
            const dx = t.clientX - candidate.x;
            const dy = t.clientY - candidate.y;
            if (dx * dx + dy * dy > MOVE_TOL * MOVE_TOL) {
              clearTimeout(candidate.timer);
              candidate = null;
              break;
            }
          }
        }
        if (!this.moveMode) return;
        if (e.cancelable) e.preventDefault(); // hold the page still while moving
        const touches = e.touches && e.touches.length ? Array.from(e.touches) : Array.from(e.changedTouches || []);
        const t = touches[0];
        if (t) this.updateMove(t.clientX, t.clientY);
      },
      { passive: false }
    );

    const endTouch = (e, isCancel) => {
      if (candidate && e.changedTouches) {
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier === candidate.id) {
            clearTimeout(candidate.timer);
            candidate = null;
            break;
          }
        }
      }
      if (!this.moveMode) return;
      if (isCancel) {
        this.cancelMove();
        return;
      }
      let lx = this.moveMode.lastX;
      let ly = this.moveMode.lastY;
      if (e.changedTouches && e.changedTouches.length) {
        const last = Array.from(e.changedTouches).pop();
        lx = last.clientX;
        ly = last.clientY;
      }
      const m = this.moveMode;
      this.updateMoveTarget(lx, ly);
      const target = m.target;
      this.cancelMove();
      if (target) this.performMove(m, target);
    };

    document.addEventListener("touchend", (e) => endTouch(e, false), { passive: true });
    document.addEventListener("touchcancel", (e) => endTouch(e, true), { passive: true });
    this.register(() => {
      if (candidate) clearTimeout(candidate.timer);
    });
  }

  startMoveMode(c) {
    const entry = this.entries.get(c.src);
    if (!entry) return;
    const view = this.firstConnectedView(entry);
    if (!view) return;
    let sec = null;
    try {
      sec =
        view.sectionCtx && typeof view.sectionCtx.getSectionInfo === "function"
          ? view.sectionCtx.getSectionInfo(view.sectionEl)
          : null;
    } catch (_) {
      sec = null;
    }
    if (!sec || !Number.isFinite(sec.lineStart) || !Number.isFinite(sec.lineEnd)) return;
    this.moveMode = {
      src: c.src,
      lineStart: sec.lineStart,
      lineEnd: sec.lineEnd,
      lastX: c.x,
      lastY: c.y,
      target: null,
      scroller: this.scrollableAncestor(view.zoneEl),
    };
    view.zoneEl.classList.add("pz-moving");
    try {
      document.body.classList.add("pz-moving-active");
    } catch (_) {}
    this.updateMoveTarget(c.x, c.y);
  }

  cancelMove() {
    if (!this.moveMode) return;
    const entry = this.entries.get(this.moveMode.src);
    if (entry) {
      const view = this.firstConnectedView(entry);
      if (view) view.zoneEl.classList.remove("pz-moving");
    }
    this.moveMode = null;
    this.hideDropCursor();
    try {
      document.body.classList.remove("pz-moving-active");
    } catch (_) {}
  }

  updateMove(x, y) {
    const m = this.moveMode;
    if (!m) return;
    m.lastX = x;
    m.lastY = y;
    // Edge auto-scroll so long notes stay reachable.
    try {
      const vh = (typeof window !== "undefined" && window.innerHeight) || 800;
      const sc = m.scroller;
      if (sc) {
        if (y < 80) sc.scrollTop -= 12;
        else if (y > vh - 80) sc.scrollTop += 12;
      }
    } catch (_) {}
    this.updateMoveTarget(x, y);
  }

  cmPosAt(x, y) {
    try {
      const view = this.activeMarkdownView();
      const ed = view && view.editor;
      const cm = ed && ed.cm;
      if (!cm || typeof cm.posAtCoords !== "function") return null;
      const pos = cm.posAtCoords({ x, y });
      if (pos == null) return null;
      const ln = cm.state.doc.lineAt(pos);
      return { line: ln.number - 1, pos };
    } catch (_) {
      return null;
    }
  }

  updateMoveTarget(x, y) {
    const m = this.moveMode;
    if (!m) return;
    m.target = null;
    this.hideDropCursor();
    const mode = this.getViewMode();

    if (mode === "preview") {
      let hit = null;
      try {
        hit = document.elementFromPoint(x, y);
      } catch (_) {}
      if (!hit) return;
      const found = this.sizerBlockOf(hit);
      if (!found) return;
      const kids = found.sizer.children;
      const idx = Array.prototype.indexOf.call(kids, found.block);
      if (idx < 0) return;
      const r = found.block.getBoundingClientRect();
      const after = y >= r.top + r.height / 2;
      // No-op when the target block contains our own zone.
      const zView = this.firstConnectedView(this.entries.get(m.src));
      try {
        if (found.block.querySelector && found.block.querySelector('.pz-zone[data-src="' + m.src + '"]')) return;
        if (zView && found.block.contains && found.block.contains(zView.zoneEl)) return;
      } catch (_) {}
      const cx = Math.max(r.left + 2, Math.min(x, r.right - 4));
      const cy = after ? r.bottom - 13 : r.top - 13;
      this.showDropCursor(cx, cy, 26);
      m.target = { kind: "block", index: idx, after };
      return;
    }

    // Live Preview / source edit mode: exact source line via CodeMirror.
    const hit = this.cmPosAt(x, y);
    if (!hit) return;
    if (hit.line >= m.lineStart && hit.line <= m.lineEnd) return; // inside our own fence: no-op
    let lineEl = null;
    try {
      const el = document.elementFromPoint(x, y);
      lineEl = el && el.closest ? el.closest(".cm-line") : null;
    } catch (_) {}
    if (!lineEl || !lineEl.getBoundingClientRect) return;
    const r = lineEl.getBoundingClientRect();
    const after = y >= r.top + r.height / 2;
    const cx = Math.max(r.left + 2, Math.min(x, r.right - 4));
    const cy = after ? r.bottom - 13 : r.top - 13;
    this.showDropCursor(cx, cy, 26);
    m.target = { kind: "line", line: hit.line, after };
  }

  // Move the fence to the drop target. Verifies the fence text first so a
  // stale mapping aborts instead of corrupting the note.
  async performMove(m, target) {
    try {
      const file = this.activeFile();
      if (!file) return;
      const entry = this.entries.get(m.src);
      // Fresh section info when possible (content may have shifted).
      let a = m.lineStart;
      let b = m.lineEnd;
      if (entry) {
        const view = this.firstConnectedView(entry);
        try {
          const sec =
            view && view.sectionCtx && typeof view.sectionCtx.getSectionInfo === "function"
              ? view.sectionCtx.getSectionInfo(view.sectionEl)
              : null;
          if (sec && Number.isFinite(sec.lineStart) && Number.isFinite(sec.lineEnd)) {
            a = sec.lineStart;
            b = sec.lineEnd;
          }
        } catch (_) {}
      }

      const mode = this.getViewMode();
      const fenceRe = /^\s*```\s*pencil-draw/;
      let content, writeBack;

      if (mode === "preview") {
        content = await this.app.vault.read(file);
        writeBack = async (text) => {
          await this.app.vault.modify(file, text);
        };
      } else {
        const view = this.activeMarkdownView();
        const ed = view && view.editor;
        if (!ed) return;
        content = ed.getValue();
        writeBack = null; // editor path below
      }

      const lines = content.split("\n");
      if (a < 0 || b >= lines.length || a > b) return;
      if (!fenceRe.test(lines[a])) return;
      let hasSrc = false;
      for (let i = a; i <= b && i < lines.length; i++) {
        if (lines[i].indexOf("src: " + m.src) !== -1) {
          hasSrc = true;
          break;
        }
      }
      if (!hasSrc) return;

      // Insertion line in original coords (fence goes BEFORE this line).
      let t = -1;
      if (target.kind === "line") {
        t = target.after ? target.line + 1 : target.line;
      } else {
        const blocks = splitBlocks(lines).filter((blk) => !blk.meta);
        const blk = blocks[target.index];
        if (!blk) return;
        // Own block => no-op.
        const ownIdx = blocks.findIndex((blk2) => a >= blk2.start && a <= blk2.end);
        if (ownIdx === target.index) return;
        t = target.after ? blk.end + 1 : blk.start;
      }
      t = Math.max(0, Math.min(t, lines.length));
      const len = b - a + 1;
      let tAdj = t > b ? t - len : t;
      if (tAdj === a) return; // same place: no-op

      const fence = lines.slice(a, b + 1);
      const rest = lines.slice(0, a).concat(lines.slice(b + 1));

      if (mode === "preview") {
        const out = rest.slice(0, tAdj).concat(fence, rest.slice(tAdj));
        await writeBack(out.join("\n"));
      } else {
        const view = this.activeMarkdownView();
        const ed = view && view.editor;
        if (!ed) return;
        const fenceStr = fence.join("\n");
        const ls = lineStartsOf(content);
        let delFrom, delTo;
        if (b + 1 < lines.length) {
          delFrom = ls[a];
          delTo = ls[b + 1];
        } else if (a > 0) {
          delFrom = ls[a] - 1;
          delTo = content.length;
        } else {
          return; // whole file is the fence
        }
        ed.replaceRange("", ed.offsetToPos(delFrom), ed.offsetToPos(delTo));
        const restText = rest.join("\n");
        const ls2 = lineStartsOf(restText);
        let insOff, insStr;
        if (tAdj < rest.length) {
          insOff = ls2[tAdj];
          insStr = fenceStr + "\n";
        } else {
          insOff = restText.length;
          insStr = (rest.length ? "\n" : "") + fenceStr;
        }
        ed.replaceRange(insStr, ed.offsetToPos(insOff), ed.offsetToPos(insOff));
      }
      this.setActive(m.src);
    } catch (e) {
      console.warn("Pencil Zones: move failed", e);
    }
  }

  // ---------- drawing zone view ----------

  renderZone(source, el, ctx) {
    const params = parseCodeSource(source);
    const src = this.svgPath((params.src || "").trim());
    let height = parseInt(params.height || "", 10);
    if (!Number.isFinite(height) || height <= 0) height = this.settings.defaultHeight || 300;
    height = Math.min(1200, Math.max(150, height));
    const showLines = params.lines != null ? parseLinesFlag(params.lines) : !!this.settings.defaultLines;

    if (!src) {
      el.createEl("div", { text: "⚠️ pencil-draw block is missing `src:`" });
      return;
    }

    const plugin = this;
    const entry = this.getEntry(src, height, showLines);
    const SVGNS = "http://www.w3.org/2000/svg";

    const zone = el.createDiv({ cls: "pz-zone" });
    zone.dataset.src = src;
    if (entry.src === this.activeSrc) zone.classList.add("pz-active");

    const svg = document.createElementNS(SVGNS, "svg");
    svg.classList.add("pz-canvas");
    svg.setAttribute("viewBox", `0 0 ${CANVAS_W} ${Math.round(entry.height)}`);
    svg.setAttribute("width", String(CANVAS_W));
    svg.setAttribute("height", String(Math.round(entry.height)));
    svg.style.height = Math.round(entry.height) + "px";
    zone.appendChild(svg);

    let activeStroke = null;
    let activePathEl = null;
    let activePointerId = null;
    let ring = null; // pixel-eraser cursor ring

    function toSvgCoords(e) {
      const r = svg.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * CANVAS_W;
      const y = ((e.clientY - r.top) / r.height) * entry.height;
      return { x: Math.max(0, Math.min(CANVAS_W, x)), y: Math.max(0, Math.min(entry.height, y)) };
    }

    function updateActivePath() {
      if (!activePathEl || !activeStroke) return;
      activePathEl.setAttribute("d", pathD(activeStroke.points));
      if (isDynamicColor(activeStroke.color)) activePathEl.setAttribute("class", "pz-ink");
      else activePathEl.setAttribute("stroke", activeStroke.color);
      activePathEl.setAttribute("stroke-width", String(strokeWidthFor(activeStroke)));
      activePathEl.setAttribute("stroke-opacity", String(strokeOpacityFor(activeStroke)));
    }

    function render() {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      ring = null;
      // No background rect: the theme background shows through.
      if (entry.lines) {
        for (let y = LINE_SPACING; y < entry.height; y += LINE_SPACING) {
          const ln = document.createElementNS(SVGNS, "line");
          ln.setAttribute("class", "pz-rule");
          ln.setAttribute("x1", "0");
          ln.setAttribute("y1", String(y));
          ln.setAttribute("x2", String(CANVAS_W));
          ln.setAttribute("y2", String(y));
          ln.setAttribute("stroke-width", "1");
          svg.appendChild(ln);
        }
      }
      const g = document.createElementNS(SVGNS, "g");
      for (const s of entry.strokes) {
        const p = document.createElementNS(SVGNS, "path");
        p.setAttribute("d", pathD(s.points));
        if (isDynamicColor(s.color)) p.setAttribute("class", "pz-ink");
        else p.setAttribute("stroke", s.color || "#000000");
        p.setAttribute("fill", "none");
        p.setAttribute("stroke-width", String(strokeWidthFor(s)));
        p.setAttribute("stroke-opacity", String(strokeOpacityFor(s)));
        p.setAttribute("stroke-linecap", "round");
        p.setAttribute("stroke-linejoin", "round");
        g.appendChild(p);
      }
      svg.appendChild(g);
      if (activePathEl && activeStroke) g.appendChild(activePathEl);
      svg.setAttribute("viewBox", `0 0 ${CANVAS_W} ${Math.round(entry.height)}`);
      svg.setAttribute("height", String(Math.round(entry.height)));
      svg.style.height = Math.round(entry.height) + "px";
    }

    function cancelStroke() {
      activePointerId = null;
      activeStroke = null;
      activePathEl = null;
      render();
    }

    // Object eraser: removes whole strokes on contact.
    function objectEraseAt(pt) {
      let changed = false;
      const keep = [];
      for (const s of entry.strokes) {
        let hit = false;
        for (const p of s.points) {
          const dx = p.x - pt.x;
          const dy = p.y - pt.y;
          const pad = strokeWidthFor(s) / 2 + ERASER_RADIUS;
          if (dx * dx + dy * dy <= pad * pad) {
            hit = true;
            break;
          }
        }
        if (hit) changed = true;
        else keep.push(s);
      }
      if (changed) {
        entry.strokes = keep;
        render();
      }
      return changed;
    }

    // Pixel eraser: removes only points inside the round section,
    // splitting strokes into surviving segments.
    function pixelEraseAt(pt) {
      const R2 = PIXEL_ERASER_RADIUS * PIXEL_ERASER_RADIUS;
      let changed = false;
      const next = [];
      for (const s of entry.strokes) {
        const runs = [];
        let cur = [];
        for (const p of s.points) {
          const dx = p.x - pt.x;
          const dy = p.y - pt.y;
          if (dx * dx + dy * dy <= R2) {
            if (cur.length) {
              runs.push(cur);
              cur = [];
            }
          } else {
            cur.push(p);
          }
        }
        if (cur.length) runs.push(cur);
        if (runs.length === 1 && runs[0].length === s.points.length) {
          next.push(s); // untouched
        } else {
          changed = true;
          for (const r of runs) {
            if (r.length >= 2) next.push({ points: r, color: s.color, tool: s.tool });
          }
        }
      }
      if (changed) {
        entry.strokes = next;
        render();
      }
      return changed;
    }

    function ensureRing() {
      if (ring && ring.isConnected) return ring;
      ring = document.createElementNS(SVGNS, "circle");
      ring.setAttribute("r", String(PIXEL_ERASER_RADIUS));
      ring.setAttribute("fill", "none");
      ring.setAttribute("stroke", "#999999");
      ring.setAttribute("stroke-width", "1.5");
      ring.style.pointerEvents = "none";
      ring.style.display = "none";
      svg.appendChild(ring);
      return ring;
    }

    function moveRing(pt) {
      const r = ensureRing();
      r.setAttribute("cx", String(pt.x));
      r.setAttribute("cy", String(pt.y));
      r.style.display = "block";
    }

    function hideRing() {
      if (ring && ring.isConnected) ring.style.display = "none";
    }

    const view = { zoneEl: zone, render, cancelStroke, sectionEl: el, sectionCtx: ctx };
    entry.views.add(view);
    render();
    plugin.updateToolbarVisibility();

    const isEraserTool = () => plugin.tool === "eraser" || plugin.tool === "pxeraser";

    // ---- drawing: pen + mouse only. Touch never draws. ----
    // finalizeActive commits (or drops, when asked) whatever track state
    // exists. Fresh pen/mouse contact ALWAYS recovers through it first:
    // on iPad a pen stroke can lose its pointerup/cancel around
    // multi-touch (or a setPointerCapture race), which used to leave
    // activePointerId set forever and silently refuse all later input.
    function finalizeActive(commit) {
      if (activePointerId === null && !activeStroke) return false;
      const pid = activePointerId;
      const wasEraser = isEraserTool();
      const hadStroke = !!activeStroke && activeStroke.points.length > 0;
      activePointerId = null;
      hideRing();
      if (!wasEraser && hadStroke && commit) {
        plugin.pushUndo(entry);
        entry.redo = [];
        entry.strokes.push(activeStroke);
        plugin.scheduleSave(entry);
      }
      activeStroke = null;
      activePathEl = null;
      render();
      plugin.dlog("stroke-finalize", "id=" + pid + " eraser=" + wasEraser + " pts=" + (hadStroke ? "yes" : "no") + " commit=" + commit);
      return true;
    }

    svg.addEventListener("pointerdown", (e) => {
      plugin.setActive(entry.src);
      if (e.pointerType === "touch") return; // fingers scroll / gesture / move, never draw
      plugin.showToolbar();
      finalizeActive(true); // recover from any stuck state, never refuse input
      e.preventDefault();
      try {
        svg.setPointerCapture(e.pointerId);
      } catch (_) {
        plugin.dlog("stroke-abort", "id=" + e.pointerId + " capture-failed");
        return; // don't track a pointer we can't follow
      }
      const pt = toSvgCoords(e);
      activePointerId = e.pointerId;
      plugin.dlog("stroke-down", "id=" + e.pointerId + " tool=" + plugin.tool);

      if (isEraserTool()) {
        plugin.pushUndo(entry);
        entry.redo = [];
        if (plugin.tool === "pxeraser") {
          pixelEraseAt(pt);
          moveRing(pt);
        } else {
          objectEraseAt(pt);
        }
        plugin.scheduleSave(entry);
        return;
      }
      activeStroke = { points: [pt], color: plugin.color, tool: plugin.tool };
      activePathEl = document.createElementNS(SVGNS, "path");
      activePathEl.setAttribute("fill", "none");
      activePathEl.setAttribute("stroke-linecap", "round");
      activePathEl.setAttribute("stroke-linejoin", "round");
      updateActivePath();
      svg.appendChild(activePathEl);
    });

    svg.addEventListener("pointermove", (e) => {
      if (e.pointerId !== activePointerId || e.pointerType === "touch") return;
      e.preventDefault();
      const pt = toSvgCoords(e);
      if (isEraserTool()) {
        if (plugin.tool === "pxeraser") {
          pixelEraseAt(pt);
          moveRing(pt);
        } else {
          objectEraseAt(pt);
        }
        plugin.scheduleSave(entry);
        return;
      }
      if (!activeStroke) return;
      const last = activeStroke.points[activeStroke.points.length - 1];
      const dx = pt.x - last.x;
      const dy = pt.y - last.y;
      if (dx * dx + dy * dy < 1.2) return;
      activeStroke.points.push(pt);
      updateActivePath();
    });

    function finishStroke(e) {
      if (e.pointerId !== activePointerId) return;
      plugin.dlog("stroke-up", "id=" + e.pointerId);
      finalizeActive(true);
    }
    function cancelStrokeInput(e) {
      if (e.pointerId !== activePointerId) return;
      plugin.dlog("stroke-cancel", "id=" + e.pointerId + " type=" + e.type);
      finalizeActive(true); // commit partial ink rather than losing it
    }
    svg.addEventListener("pointerup", finishStroke);
    svg.addEventListener("pointercancel", cancelStrokeInput);
    svg.addEventListener("lostpointercapture", cancelStrokeInput);
    svg.addEventListener("pointerleave", () => {
      if (activePointerId === null) hideRing();
    });

    // Tapping a zone marks it active + reveals the toolbar.
    zone.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") return;
      plugin.setActive(entry.src);
      plugin.showToolbar();
    });

    // Prevent iPad pinch-zoom / callout interference inside the zone.
    zone.addEventListener("gesturestart", (e) => e.preventDefault());
    zone.addEventListener("dblclick", (e) => e.preventDefault());
    zone.addEventListener("contextmenu", (e) => {
      if (e.target.closest && e.target.closest(".pz-resize")) return;
      e.preventDefault();
    });

    // ---- resize handle (drag the three dots at the bottom edge) ----
    const resize = zone.createDiv({ cls: "pz-resize" });
    for (let i = 0; i < 3; i++) resize.createSpan({ cls: "pz-dot" });
    let resizing = false;
    let resizeStartY = 0;
    let resizeStartH = 0;
    resize.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      plugin.setActive(entry.src);
      resizing = true;
      resizeStartY = e.clientY;
      resizeStartH = entry.height;
      try {
        resize.setPointerCapture(e.pointerId);
      } catch (_) {}
    });
    resize.addEventListener("pointermove", (e) => {
      if (!resizing) return;
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const scale = entry.height / Math.max(1, r.height);
      entry.height = Math.min(1200, Math.max(150, resizeStartH + (e.clientY - resizeStartY) * scale));
      render();
    });
    async function endResize(e) {
      if (!resizing) return;
      resizing = false;
      try {
        resize.releasePointerCapture(e.pointerId);
      } catch (_) {}
      render();
      await plugin.saveEntry(entry);
      plugin.persistBlockParams(entry.src, { height: entry.height });
    }
    resize.addEventListener("pointerup", endResize);
    resize.addEventListener("pointercancel", endResize);
  }
}

class PencilZonesSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Pencil Zones" });

    new Setting(containerEl)
      .setName("SVG folder")
      .setDesc("Vault-relative root folder where drawing SVGs are stored.")
      .addText((t) =>
        t
          .setPlaceholder("_inline_handwriting")
          .setValue(this.plugin.settings.svgFolder)
          .onChange(async (v) => {
            this.plugin.settings.svgFolder = (v || "_inline_handwriting").trim().replace(/^\//, "").replace(/\/$/, "");
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default height")
      .setDesc("Height in px for new drawing zones (150–1200, draggable later).")
      .addText((t) =>
        t
          .setPlaceholder("300")
          .setValue(String(this.plugin.settings.defaultHeight))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (Number.isFinite(n)) {
              this.plugin.settings.defaultHeight = Math.min(1200, Math.max(150, n));
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Ruled lines on new zones")
      .setDesc("Draw light ruled lines behind new drawing zones. Toggle per zone with 📏.")
      .addToggle((t) =>
        t.setValue(!!this.plugin.settings.defaultLines).onChange(async (v) => {
          this.plugin.settings.defaultLines = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Verbose console logging")
      .setDesc("Mirror input diagnostics (strokes, gestures, recovery) to the console. The buffer always records; use the Copy input diagnostics command to export it.")
      .addToggle((t) =>
        t.setValue(!!this.plugin.settings.verboseLog).onChange(async (v) => {
          this.plugin.settings.verboseLog = v;
          await this.plugin.saveSettings();
        })
      );
  }
}

// Obsidian loads main.js as CommonJS; expose both forms.
module.exports = PencilZonesPlugin;
module.exports.default = PencilZonesPlugin;

// Exported for local sanity tests only (no effect inside Obsidian).
PencilZonesPlugin._test = {
  buildSVG,
  extractData,
  parseCodeSource,
  parseLinesFlag,
  isDynamicColor,
  isBlackHex,
  splitBlocks,
  lineStartsOf,
};

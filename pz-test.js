// Harness: stub Obsidian + minimal DOM, drive renderZone + gestures (touch events).
const Module = require("module");
const origLoad = Module._load;

class FakeClassList {
  constructor() { this._s = new Set(); }
  add(c) { this._s.add(c); }
  remove(c) { this._s.delete(c); }
  toggle(c, force) {
    if (force === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
    else if (force) this._s.add(c); else this._s.delete(c);
  }
  contains(c) { return this._s.has(c); }
}
class FakeEl {
  constructor(tag) {
    this.tag = tag; this.children = []; this.dataset = {};
    this.style = {}; this.attrs = {}; this._on = {};
    this.classList = new FakeClassList();
    this.parentNode = null; this.text = "";
    this.offsetWidth = 120; this.offsetHeight = 300;
  }
  get firstChild() { return this.children[0] || null; }
  get isConnected() {
    // Real semantics: connected iff attached under the document root.
    // (The old hardcoded `true` made view-staleness bugs invisible.)
    let n = this;
    const seen = new Set();
    while (n) {
      if (n._isRoot) return true;
      if (seen.has(n)) return false;
      seen.add(n);
      n = n.parentNode;
    }
    return false;
  }
  createDiv(o) { return this._mk("div", o); }
  createEl(tag, o) { return this._mk(tag, o); }
  createSpan(o) { return this._mk("span", o); }
  _mk(tag, o) {
    const c = new FakeEl(tag);
    if (o && o.cls) String(o.cls).split(/\s+/).forEach((k) => k && c.classList.add(k));
    if (o && o.text) c.text = o.text;
    this.appendChild(c); return c;
  }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
  empty() { for (const c of this.children) c.parentNode = null; this.children = []; }
  setAttribute(k, v) { this.attrs[k] = v; }
  setText(t) { this.text = t; }
  addEventListener(t, f) { (this._on[t] = this._on[t] || []).push(f); }
  removeEventListener(t, f) { this._on[t] = (this._on[t] || []).filter((x) => x !== f); }
  querySelector() { return null; }
  closest(sel) {
    const m = /^\.([\w-]+)$/.exec(sel || "");
    let n = this;
    while (n) {
      if (m && n.classList && n.classList.contains(m[1])) return n;
      n = n.parentNode;
    }
    return null;
  }
  getBoundingClientRect() { return { left: 0, top: 400, width: 400, height: 150, right: 400 }; }
  setPointerCapture() {}
  releasePointerCapture() {}
  contains(n) {
    if (n === this) return true;
    for (const c of this.children) { if (c.contains(n)) return true; }
    return false;
  }
}
const fakeDoc = {
  body: new FakeEl("body"),
  _on: {},
  activeElement: null,
  addEventListener(t, f) { (this._on[t] = this._on[t] || []).push(f); },
  removeEventListener(t, f) { this._on[t] = (this._on[t] || []).filter((x) => x !== f); },
  createElementNS(ns, tag) { return new FakeEl(tag); },
  elementFromPoint() { return null; },
};
fakeDoc.body._isRoot = true;
// Render hosts must hang off the document root, like real Live Preview
// containers, or isConnected-based pruning can never be exercised.
function mkHost() {
  const h = new FakeEl("div");
  fakeDoc.body.appendChild(h);
  return h;
}
function detach(el) {
  if (el && el.parentNode) el.parentNode.removeChild(el);
}
global.document = fakeDoc;
global.MutationObserver = class { observe() {} disconnect() {} };

class Chain {
  setName() { return this; } setDesc() { return this; }
  addText(fn) { if (fn) fn(new Chain()); return this; }
  addToggle(fn) { if (fn) fn(new Chain()); return this; }
  setPlaceholder() { return this; } setValue() { return this; } onChange() { return this; }
}
class StubPlugin {
  constructor(app) { this.app = app; }
  register() {} registerEvent() {} registerDomEvent() {}
  registerMarkdownCodeBlockProcessor() {}
  addCommand() {} addSettingTab() {}
  async loadData() { return {}; }
  async saveData() {}
}
Module._load = function (req, ...rest) {
  if (req === "obsidian") {
    return { Plugin: StubPlugin, PluginSettingTab: class {}, Setting: Chain, MarkdownView: class {} };
  }
  return origLoad.call(this, req, ...rest);
};

const P = require("./main.js");

let files = {};
let mockView = null;
let mockFile = null;
const fakeApp = {
  vault: {
    adapter: {
      exists: async (p) => p in files,
      read: async (f) => files[typeof f === "string" ? f : f.path],
      write: async (p, t) => { files[p] = t; },
    },
    create: async (p, t) => { files[p] = t; },
    read: async (f) => files[typeof f === "string" ? f : f.path],
    modify: async (f, t) => { files[typeof f === "string" ? f : f.path] = t; },
  },
  workspace: { on: () => ({}), getActiveViewOfType: () => mockView, getActiveFile: () => mockFile },
};

function fire(el, type, evt) {
  // bubble like the DOM: target first, ancestors, then document.
  // Honors stopPropagation (resize handle relies on it).
  if (evt) {
    if (evt.target === undefined) evt.target = el;
    const origStop = evt.stopPropagation;
    evt.stopPropagation = function () {
      evt._stopped = true;
      if (origStop) return origStop.apply(this, arguments);
    };
  }
  let n = el, sawDoc = false;
  while (n) {
    if (n === fakeDoc) sawDoc = true;
    for (const f of ((n._on && n._on[type]) || [])) f(evt);
    if (evt && evt._stopped) return;
    n = n.parentNode;
  }
  if (!sawDoc) for (const f of ((fakeDoc._on[type]) || [])) f(evt);
}
function pev(over) {
  return Object.assign(
    { pointerType: "pen", pointerId: 1, clientX: 100, clientY: 50, preventDefault() {}, stopPropagation() {} },
    over
  );
}
function tev(type, touches, changed) {
  return { type, touches, changedTouches: changed, preventDefault() {}, stopPropagation() {} };
}
function touch(id, x, y) { return { identifier: id, clientX: x, clientY: y }; }
function findKids(el, cls) {
  const out = [];
  (function walk(n) {
    if (n.classList && n.classList.contains(cls)) out.push(n);
    for (const c of n.children) walk(c);
  })(el);
  return out;
}
function findTag(el, tag) {
  let found = null;
  (function walk(n) {
    if (found) return;
    if (n.tag === tag) { found = n; return; }
    for (const c of n.children) walk(c);
  })(el);
  return found;
}

(async () => {
  const plugin = new P(fakeApp);
  await plugin.onload();
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name); };

  const T = P._test;
  ok("default color is dynamic", plugin.color === "dynamic");
  ok("isBlackHex", T.isBlackHex("#000000") && T.isBlackHex("#000") && !T.isBlackHex("#FFD400"));

  // saved SVG: transparent (no rect), themed style, dynamic class
  const svgText = T.buildSVG([{ points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], color: "dynamic", tool: "pencil" }], 800, 300, true);
  ok("saved svg has no bg rect", !svgText.includes("<rect"));
  ok("saved svg has theme style", svgText.includes("prefers-color-scheme"));
  ok("saved svg dynamic path has class", svgText.includes('class="pz-ink"'));
  ok("saved svg lines have class", svgText.includes('class="pz-rule"'));
  const back = T.extractData(svgText);
  ok("round-trip", back.strokes.length === 1 && back.lines === true);

  // legacy black migrates to dynamic on load
  files["test/legacy.svg"] = T.buildSVG(
    [{ points: [{ x: 1, y: 1 }, { x: 5, y: 5 }], color: "#000000", tool: "pencil" },
     { points: [{ x: 2, y: 2 }, { x: 6, y: 6 }], color: "#E53935", tool: "pencil" }], 800, 300, false);
  const host0 = mkHost();
  plugin.renderZone("src: test/legacy.svg\nheight: 300", host0, {});
  await new Promise((r) => setTimeout(r, 50));
  const legacyEntry = plugin.entries.get("test/legacy.svg");
  ok("legacy black migrated", legacyEntry.strokes[0].color === "dynamic");
  ok("legacy red untouched", legacyEntry.strokes[1].color === "#E53935");
  ok("legacy strokes render at default width", (() => {
    const g = findTag(host0, "g");
    return !!g && g.children.every((c) => c.attrs["stroke-width"] === "2");
  })());
  const g0 = findTag(host0, "g");
  ok("live dynamic path uses class", g0 && g0.children[0].attrs.class === "pz-ink");

  // main zone: pen draws with dynamic ink by default
  const host = mkHost();
  plugin.renderZone("src: test/file.svg\nheight: 300\nlines: false", host, {});
  const zone = findKids(host, "pz-zone")[0];
  // gestures locate the zone under the fingers via elementFromPoint
  fakeDoc.elementFromPoint = () => ({ closest: (sel) => (sel === ".pz-zone" ? zone : null) });
  const svg = zone.children.find((c) => c.tag === "svg");
  const entry = plugin.entries.get("test/file.svg");
  fire(svg, "pointerdown", pev({ pointerId: 1, clientX: 50, clientY: 30 }));
  fire(svg, "pointermove", pev({ pointerId: 1, clientX: 60, clientY: 35 }));
  fire(svg, "pointerup", pev({ pointerId: 1 }));
  ok("pen stroke stored as dynamic", entry.strokes.length === 1 && entry.strokes[0].color === "dynamic");

  // touch never draws
  fire(svg, "pointerdown", pev({ pointerType: "touch", pointerId: 9, clientX: 10, clientY: 10 }));
  fire(svg, "pointerup", pev({ pointerType: "touch", pointerId: 9 }));
  ok("touch draws nothing", entry.strokes.length === 1);

  // 2-finger tap (touch events) with jitter -> undo
  fire(fakeDoc, "touchstart", tev("touchstart", [touch(10, 100, 100)], [touch(10, 100, 100)]));
  fire(fakeDoc, "touchmove", tev("touchmove", [touch(10, 102, 101)], [touch(10, 102, 101)]));
  fire(fakeDoc, "touchstart", tev("touchstart", [touch(10, 102, 101), touch(11, 200, 200)], [touch(11, 200, 200)]));
  fire(fakeDoc, "touchend", tev("touchend", [touch(11, 200, 200)], [touch(10, 102, 101)]));
  fire(fakeDoc, "touchend", tev("touchend", [], [touch(11, 200, 200)]));
  ok("2-finger tap undoes", entry.strokes.length === 0);

  // staggered 3-finger tap (slow landing) -> redo
  fire(fakeDoc, "touchstart", tev("touchstart", [touch(20, 100, 100)], [touch(20, 100, 100)]));
  fire(fakeDoc, "touchstart", tev("touchstart", [touch(20, 100, 100), touch(21, 150, 100)], [touch(21, 150, 100)]));
  fire(fakeDoc, "touchstart", tev("touchstart", [touch(20, 100, 100), touch(21, 150, 100), touch(22, 200, 100)], [touch(22, 200, 100)]));
  fire(fakeDoc, "touchend", tev("touchend", [touch(21, 150, 100), touch(22, 200, 100)], [touch(20, 100, 100)]));
  fire(fakeDoc, "touchend", tev("touchend", [touch(22, 200, 100)], [touch(21, 150, 100)]));
  fire(fakeDoc, "touchend", tev("touchend", [], [touch(22, 200, 100)]));
  ok("3-finger tap redoes", entry.strokes.length === 1);

  // drifting finger rejects
  fire(fakeDoc, "touchstart", tev("touchstart", [touch(30, 100, 100)], [touch(30, 100, 100)]));
  fire(fakeDoc, "touchstart", tev("touchstart", [touch(30, 100, 100), touch(31, 200, 200)], [touch(31, 200, 200)]));
  fire(fakeDoc, "touchmove", tev("touchmove", [touch(30, 100, 100), touch(31, 300, 300)], [touch(31, 300, 300)]));
  fire(fakeDoc, "touchend", tev("touchend", [touch(31, 300, 300)], [touch(30, 100, 100)]));
  fire(fakeDoc, "touchend", tev("touchend", [], [touch(31, 300, 300)]));
  ok("moved fingers do not undo", entry.strokes.length === 1);

  // touchcancel discards session
  fire(fakeDoc, "touchstart", tev("touchstart", [touch(40, 100, 100)], [touch(40, 100, 100)]));
  fire(fakeDoc, "touchstart", tev("touchstart", [touch(40, 100, 100), touch(41, 200, 200)], [touch(41, 200, 200)]));
  fire(fakeDoc, "touchcancel", tev("touchcancel", [], [touch(40, 100, 100), touch(41, 200, 200)]));
  ok("cancel clears session", entry.strokes.length === 1);

  // pixel eraser still splits
  plugin.tool = "pxeraser";
  entry.strokes = [{ points: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60].map((x) => ({ x, y: 10 })), color: "dynamic", tool: "pencil", width: 3 }];
  entry.undo = []; entry.redo = [];
  fire(svg, "pointerdown", pev({ pointerId: 2, clientX: 17.5, clientY: 5 }));
  fire(svg, "pointerup", pev({ pointerId: 2 }));
  ok("pixel eraser splits line", entry.strokes.length === 2);
  ok("pixel eraser preserves widths", entry.strokes.every((s) => s.width === 3));

  // toolbar layout: NO grip; body cols: colors (5) + tools (5)
  ok("no grip element", findKids(plugin.toolbarEl, "pz-grip").length === 0);
  const cols = findKids(plugin.toolbarEl, "pz-col");
  ok("two toolbar columns", cols.length === 2);
  ok("5 color swatches, first dynamic", cols[0].children.length === 5 && cols[0].children[0].children[0].classList.contains("pz-dynamic"));
  ok("5 tool buttons", cols[1].children.length === 5);

  // dock: finger swipe on background docks; taps and button touches don't
  plugin.settings.dockSide = "right";
  plugin.toolbarEl.getBoundingClientRect = () => ({ left: 800, top: 400, width: 120, height: 300, right: 920 });
  const bar = plugin.toolbarEl;
  const te = (over) => Object.assign({ pointerType: "touch", preventDefault() {}, stopPropagation(){}, target: bar }, over);
  fire(bar, "pointerdown", te({ pointerId: 51, clientX: 860, clientY: 450 }));
  fire(bar, "pointermove", te({ pointerId: 51, clientX: 850, clientY: 450 }));
  fire(bar, "pointerup", te({ pointerId: 51, clientX: 850, clientY: 450 }));
  await new Promise((r) => setTimeout(r, 20));
  // instant moves => huge velocity => direction (leftward) wins over position
  ok("fast leftward swipe docks left", plugin.settings.dockSide === "left");
  ok("snap adds animation class", plugin.toolbarEl.classList.contains("pz-snapping"));
  await new Promise((r) => setTimeout(r, 400));
  ok("snap class removed after glide", !plugin.toolbarEl.classList.contains("pz-snapping"));
  // plain tap (no slide) changes nothing
  plugin.settings.dockSide = "right";
  fire(bar, "pointerdown", te({ pointerId: 52, clientX: 860, clientY: 450 }));
  fire(bar, "pointerup", te({ pointerId: 52, clientX: 861, clientY: 450 }));
  await new Promise((r) => setTimeout(r, 20));
  ok("tap without slide keeps dock", plugin.settings.dockSide === "right");
  // touch starting on a button never starts a drag
  const colorBtn = cols[0].children[0];
  fire(bar, "pointerdown", te({ pointerId: 53, clientX: 860, clientY: 450, target: colorBtn }));
  fire(bar, "pointermove", te({ pointerId: 53, clientX: 700, clientY: 450, target: colorBtn }));
  fire(bar, "pointerup", te({ pointerId: 53, clientX: 700, clientY: 450, target: colorBtn }));
  await new Promise((r) => setTimeout(r, 20));
  ok("button touch starts no drag", plugin.settings.dockSide === "right");

  // splitBlocks unit checks
  const sb = T.splitBlocks(["---", "a: 1", "---", "", "# T", "", "para", "more", "", "```", "x", "```", "", "tail"]);
  ok("splitBlocks groups fence+frontmatter", JSON.stringify(sb.map((b) => [b.start, b.end, !!b.meta])) === JSON.stringify([[0,2,true],[4,4,false],[6,7,false],[9,11,false],[13,13,false]]));

  // ---- move mode (preview): long-press zone, drag after last block ----
  mockFile = { path: "note.md" };
  const noteLines = ["# Title", "", "Some text here.", "", "```pencil-draw", "src: test/move.svg", "height: 300", "```", "", "More text below."];
  files["note.md"] = noteLines.join("\n");
  mockView = { getMode: () => "preview", containerEl: { querySelector: () => null }, editor: null };

  const sizer = mkHost();
  sizer.classList.add("markdown-preview-sizer");
  const mkBlock = (cls, top, h) => {
    const b = sizer.createDiv({ cls });
    b.getBoundingClientRect = () => ({ left: 10, top, width: 300, height: h, right: 310 });
    return b;
  };
  mkBlock("el-h1", 0, 36);
  mkBlock("el-p", 50, 40);
  const bZone = sizer.createDiv({ cls: "el-pre" });
  bZone.getBoundingClientRect = () => ({ left: 10, top: 110, width: 300, height: 170, right: 310 });
  const bP2 = mkBlock("el-p", 300, 40);
  plugin.renderZone("src: test/move.svg\nheight: 300", bZone, { getSectionInfo: () => ({ lineStart: 4, lineEnd: 7 }) });
  const mzone = findKids(bZone, "pz-zone")[0];
  const msvg = mzone.children.find((c) => c.tag === "svg");
  fakeDoc.elementFromPoint = (x, y) => (y > 290 ? bP2 : y > 100 ? msvg : sizer.children[1]);
  const mtouch = (id, x, y) => ({ identifier: id, clientX: x, clientY: y, target: msvg });

  fire(fakeDoc, "touchstart", { touches: [mtouch(60, 50, 200)], changedTouches: [mtouch(60, 50, 200)] });
  await new Promise((r) => setTimeout(r, 750));
  ok("move mode starts on long-press", !!plugin.moveMode);
  ok("no cursor over own block", plugin.dropCursor.style.display === "none");
  fire(fakeDoc, "touchmove", { touches: [mtouch(60, 50, 330)], changedTouches: [mtouch(60, 50, 330)], cancelable: true, preventDefault() {} });
  ok("cursor shown over target", plugin.dropCursor.style.display === "block");
  fire(fakeDoc, "touchend", { touches: [], changedTouches: [mtouch(60, 50, 330)] });
  await new Promise((r) => setTimeout(r, 60));
  const moved = files["note.md"].split("\n");
  ok("fence moved after last block", moved.slice(-4)[0] === "```pencil-draw" && moved.indexOf("More text below.") < moved.indexOf("src: test/move.svg"));
  ok("move cleaned up", !plugin.moveMode && plugin.dropCursor.style.display === "none");

  // ---- stuck-pointer recovery (the palm + undo dead-pencil bug) ----
  plugin.tool = "pencil"; // earlier eraser test left the global tool on eraser
  const hostR = mkHost();
  plugin.renderZone("src: test/recovery.svg\nheight: 300", hostR, {});
  const zoneR = findKids(hostR, "pz-zone")[0];
  const svgR = zoneR.children.find((c) => c.tag === "svg");
  const entryR = plugin.entries.get("test/recovery.svg");

  // pen down with NO pointerup, then a second pen contact: old code refused
  // all input forever (activePointerId stuck); new code commits + recovers.
  fire(svgR, "pointerdown", pev({ pointerId: 70, clientX: 50, clientY: 30 }));
  fire(svgR, "pointermove", pev({ pointerId: 70, clientX: 60, clientY: 35 }));
  fire(svgR, "pointerdown", pev({ pointerId: 71, clientX: 100, clientY: 60 }));
  ok("stale stroke committed on fresh pen-down", entryR.strokes.length === 1);
  fire(svgR, "pointermove", pev({ pointerId: 71, clientX: 110, clientY: 65 }));
  fire(svgR, "pointerup", pev({ pointerId: 71 }));
  ok("drawing works after recovery", entryR.strokes.length === 2);

  // lostpointercapture finalizes instead of stranding state
  fire(svgR, "pointerdown", pev({ pointerId: 72, clientX: 50, clientY: 30 }));
  fire(svgR, "pointermove", pev({ pointerId: 72, clientX: 60, clientY: 35 }));
  fire(svgR, "lostpointercapture", pev({ pointerId: 72 }));
  ok("lost capture commits stroke", entryR.strokes.length === 3);
  fire(svgR, "pointerdown", pev({ pointerId: 73, clientX: 50, clientY: 30 }));
  fire(svgR, "pointerup", pev({ pointerId: 73 }));
  ok("drawing works after lost capture", entryR.strokes.length === 4);

  // pointercancel commits (was: silently discards)
  fire(svgR, "pointerdown", pev({ pointerId: 74, clientX: 50, clientY: 30 }));
  fire(svgR, "pointermove", pev({ pointerId: 74, clientX: 70, clientY: 40 }));
  fire(svgR, "pointercancel", pev({ pointerId: 74 }));
  ok("pointercancel commits partial ink", entryR.strokes.length === 5);

  // setPointerCapture failure aborts cleanly instead of tracking a ghost
  svgR.setPointerCapture = () => { throw new Error("capture failed"); };
  fire(svgR, "pointerdown", pev({ pointerId: 75, clientX: 50, clientY: 30 }));
  fire(svgR, "pointermove", pev({ pointerId: 75, clientX: 90, clientY: 50 }));
  fire(svgR, "pointerup", pev({ pointerId: 75 }));
  ok("capture failure tracks nothing", entryR.strokes.length === 5);
  delete svgR.setPointerCapture; // restore prototype method for later tests

  // diagnostics buffer records the lifecycle
  const tags = plugin.diag.join("\n");
  ok("diag logs strokes + recovery", /stroke-down/.test(tags) && /stroke-finalize/.test(tags) && /stroke-abort/.test(tags));

  // ---- re-render survival (the draw->resize->dead bug) ----
  // Live Preview rebuilds the block after a resize rewrites the source.
  // Input is document-delegated: no per-svg listeners to strand.
  const hostR2 = mkHost();
  plugin.renderZone("src: test/recovery.svg\nheight: 300", hostR2, {});
  const zoneR2 = findKids(hostR2, "pz-zone")[0];
  const svgR2 = zoneR2.children.find((c) => c.tag === "svg");
  ok("no per-element input listeners (delegated)", !svgR2._on.pointerdown && !svgR2._on.pointerup && !svgR2._on.pointermove);
  const beforeRe = entryR.strokes.length;
  fire(svgR2, "pointerdown", pev({ pointerId: 90, clientX: 50, clientY: 30 }));
  fire(svgR2, "pointermove", pev({ pointerId: 90, clientX: 60, clientY: 35 }));
  fire(svgR2, "pointerup", pev({ pointerId: 90 }));
  ok("drawing works after re-render", entryR.strokes.length === beforeRe + 1);

  // ---- canvas resize handle ----
  plugin.tool = "pencil";
  const hostP = mkHost();
  plugin.renderZone("src: test/pinch.svg\nheight: 300", hostP, {});
  const zoneP = findKids(hostP, "pz-zone")[0];
  const svgP = zoneP.children.find((c) => c.tag === "svg");
  const entryP = plugin.entries.get("test/pinch.svg");
  const dotsP = findKids(hostP, "pz-resize")[0];
  ok("resize handle rendered with three dots", !!dotsP && dotsP.children.length === 3);
  const tick = (ms) => new Promise((r) => setTimeout(r, ms));
  mockFile = { path: "note-rz.md" };
  files["note-rz.md"] = ["# N", "", "```pencil-draw", "src: test/pinch.svg", "height: 300", "lines: false", "```", "", "tail"].join("\n");
  const mockEditorFor = (path) => {
    const off = (lines, p) => {
      let o = 0;
      for (let i = 0; i < p.line; i++) o += lines[i].length + 1;
      return o + p.ch;
    };
    return {
      getValue: () => files[path],
      offsetToPos: (o) => {
        const before = files[path].slice(0, o).split("\n");
        return { line: before.length - 1, ch: before[before.length - 1].length };
      },
      replaceRange: (txt, from, to) => {
        const lines = files[path].split("\n");
        const cur = files[path];
        files[path] = cur.slice(0, off(lines, from)) + txt + cur.slice(off(lines, to));
      },
    };
  };
  mockView = { getMode: () => "source", containerEl: { querySelector: () => null }, editor: mockEditorFor("note-rz.md") };
  const rzStroke = (svg, id, x, y) => {
    fire(svg, "pointerdown", pev({ pointerId: id, clientX: x, clientY: y }));
    fire(svg, "pointermove", pev({ pointerId: id, clientX: x + 10, clientY: y + 5 }));
    fire(svg, "pointerup", pev({ pointerId: id }));
  };
  rzStroke(svgP, 80, 50, 30);
  ok("draw before resize", entryP.strokes.length === 1);
  const hBefore = entryP.height;
  fire(dotsP, "pointerdown", pev({ pointerId: 81, clientX: 50, clientY: 300 }));
  fire(dotsP, "pointermove", pev({ pointerId: 81, clientX: 50, clientY: 340 }));
  fire(dotsP, "pointerup", pev({ pointerId: 81, clientX: 50, clientY: 340 }));
  await tick(40);
  ok("resize drag grows zone", entryP.height > hBefore);
  ok("resize leaks no stroke", entryP.strokes.length === 1);
  ok("resize persists height", files["note-rz.md"].includes(`height: ${Math.round(entryP.height)}`));
  rzStroke(svgP, 82, 50, 30);
  ok("draw works after resize", entryP.strokes.length === 2);

  // ---- re-render lifecycle: no stacking, newest wins, draw survives ----
  mockFile = { path: "note-rz.md" };
  files["note-rz.md"] = ["# N", "", "```pencil-draw", "src: test/resize.svg", "height: 300", "lines: false", "```", "", "tail"].join("\n");
  mockView = { getMode: () => "source", containerEl: { querySelector: () => null }, editor: undefined };

  let rzHost = mkHost();
  const rzSrcLine = "src: test/resize.svg";
  const rzSource = (h) => `${rzSrcLine}\nheight: ${h}\nlines: false`;
  plugin.renderZone(rzSource(300), rzHost, {});
  const entryRz = plugin.entries.get("test/resize.svg");
  const zoneRz = () => findKids(rzHost, "pz-zone")[0];
  const svgRz = () => zoneRz().children.find((c) => c.tag === "svg");
  const penStroke = (svg, id, x, y) => {
    fire(svg, "pointerdown", pev({ pointerId: id, clientX: x, clientY: y }));
    fire(svg, "pointermove", pev({ pointerId: id, clientX: x + 10, clientY: y + 5 }));
    fire(svg, "pointerup", pev({ pointerId: id }));
  };

  // element aspect must match the viewBox: otherwise the default meet-fit
  // letterboxes the ink and it no longer lands under the pencil (offset
  // grows toward the edges, content recenters on height change).
  const svgA = svgRz();
  ok("canvas preserves viewBox aspect", svgA.style.aspectRatio === "800 / 300");
  ok("canvas stretches on forced sizes", svgA.attrs.preserveAspectRatio === "none");

  // same container re-rendered repeatedly must not stack zones
  plugin.renderZone(rzSource(300), rzHost, {});
  plugin.renderZone(rzSource(300), rzHost, {});
  ok("same-el re-render keeps one zone", findKids(rzHost, "pz-zone").length === 1);
  ok("stale views pruned", Array.from(entryRz.views).filter((v) => v.zoneEl.isConnected).length === 1);
  penStroke(svgRz(), 200, 50, 30);
  ok("draw works after same-el re-renders", entryRz.strokes.length === 1);
  ok("newest view wins", plugin.firstConnectedView(entryRz).zoneEl === zoneRz());

  // fresh container (Obsidian rebuild): old detaches, draw continues
  const n0 = entryRz.strokes.length;
  detach(rzHost);
  rzHost = mkHost();
  plugin.renderZone(rzSource(300), rzHost, {});
  ok("old view pruned after detach", Array.from(entryRz.views).filter((v) => v.zoneEl.isConnected).length === 1);
  penStroke(svgRz(), 201, 50, 30);
  ok("draw works after fresh-el re-render", entryRz.strokes.length === n0 + 1);

  // reading mode (no editor) persists through the vault
  mockView = { getMode: () => "preview", containerEl: { querySelector: () => null }, editor: undefined };
  await plugin.persistBlockParams("test/resize.svg", { height: 500 });
  ok("reading persist writes file", files["note-rz.md"].includes("height: 500"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });

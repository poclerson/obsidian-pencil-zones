// One-shot: convert Inline Handwriting (puria) HTMD_*.svg files to
// Pencil Zones format. Originals are NEVER modified; new PZ_*.svg files
// are written alongside. Notes are NOT touched (rewire later).
// Usage: node convert-puria.js <vault-inline-handwriting-dir>
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Module = require("module");

const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === "obsidian") {
    return { Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, MarkdownView: class {} };
  }
  return origLoad.call(this, req, ...rest);
};
const PZ = require("./main.js")._test;

function unescapeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, "&");
}

function num(v, fb) {
  return typeof v === "number" && Number.isFinite(v) ? v : fb;
}

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: node convert-puria.js <dir>");
  const files = fs.readdirSync(dir).filter((f) => /^HTMD_.*\.svg$/.test(f)).sort();
  if (!files.length) throw new Error("no HTMD_*.svg found in " + dir);
  const manifest = [];
  for (const old of files) {
    const full = path.join(dir, old);
    const before = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    const text = fs.readFileSync(full, "utf8");
    const vb = text.match(/viewBox="0 0 (\d+) (\d+)"/);
    const H = vb ? Math.min(4000, Math.max(150, parseInt(vb[2], 10))) : 1123;
    const ruled = /<line[^>]*e4e4e4/.test(text);
    const m = text.match(/<desc class="hwm-strokes">(.*?)<\/desc>/s);
    const raw = m ? JSON.parse(unescapeEntities(m[1])) : [];
    const tools = { pencil: 0, highlighter: 0 };
    const strokes = [];
    for (const s of raw) {
      const pts = Array.isArray(s.points)
        ? s.points.filter((p) => p && Number.isFinite(+p.x) && Number.isFinite(+p.y)).map((p) => ({ x: +p.x, y: +p.y }))
        : [];
      if (!pts.length) continue;
      const tool = num(s.opacity, 1) < 0.9 ? "highlighter" : "pencil";
      tools[tool]++;
      const st = { points: pts, color: typeof s.color === "string" ? s.color : "#000000", tool };
      if (Number.isFinite(+s.width) && +s.width > 0) st.width = +s.width;
      strokes.push(st);
    }
    const out = PZ.buildSVG(strokes, 800, H, ruled);
    // verify OUR parser round-trips it before writing
    const back = PZ.extractData(out);
    if (back.strokes.length !== strokes.length) throw new Error(old + ": round-trip mismatch");
    const name = "PZ_" + old.slice("HTMD_".length);
    const dest = path.join(dir, name);
    if (fs.existsSync(dest)) throw new Error("refusing to overwrite " + name);
    fs.writeFileSync(dest, out);
    const after = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    if (before !== after) throw new Error(old + ": ORIGINAL MODIFIED");
    manifest.push({ old, new: name, height: H, lines: ruled, strokes: strokes.length, tools, sha256: before });
    console.log(`OK ${old} -> ${name} (${strokes.length} strokes, h=${H}, lines=${ruled})`);
  }
  fs.writeFileSync(path.join(__dirname, "conversion-manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nconverted ${manifest.length} files, originals untouched`);
}

main().catch((e) => { console.error("CONVERT FAILED:", e.message); process.exit(1); });

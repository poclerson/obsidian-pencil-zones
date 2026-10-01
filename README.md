# Pencil Zones

Inline Apple Pencil drawing zones for Obsidian. No build step: `main.js` + `styles.css` + `manifest.json`.

## Setup

1. Copy this folder to `<vault>/.obsidian/plugins/pencil-zones/` (or install from GitHub).
2. Enable **Pencil Zones** under Settings → Community plugins.
3. Command palette → **Insert drawing zone**, then draw with Pencil or mouse.

## Drawing

- Only Pencil and mouse draw. Fingers never draw — they scroll, tap gestures, or move zones.
- Tools: `✏️` pencil, `🖍️` highlighter, `🧽` whole-line eraser, `🧼` pixel eraser (bites a small round section, cursor ring included). Picking a color switches back to pencil.
- Ink is dynamic: black on light theme, white on dark — live and in saved files.
- Widths are hardcoded (pencil 2, highlighter 28 @ 0.35, pixel eraser radius 10). No width selector on purpose.
- `📏` toggles ruled lines per zone.

## Toolbar

One floating panel controls every zone. It only appears when the current note has a drawing zone and hides while typing.

- Drag it by the three-dot grip on top. It lives on the left or right side only: release (or fling) toward a side and it glides there, like the iPadOS drawing toolbar. Position is remembered.
- Left column: colors. Right column: tools + lines.

## Gestures & moving

- **2-finger tap** = undo, **3-finger tap** = redo (also available as commands for desktop).
- **Long-press** a zone with one finger to lift it, drag it before/after other content with a blinking caret preview, release to drop. The source is verified before rewriting, so a stale mapping aborts instead of corrupting the note.

## Storage

Each zone is a ````pencil-draw` block pointing at a standalone SVG:

````md
```pencil-draw
src: _inline_handwriting/Note-20260101-AB12.svg
height: 300
lines: false
```
````

- SVGs live in one configurable root folder (default `_inline_handwriting`), named `{Note}-{timestamp}-{rand}.svg`.
- Files are transparent (theme shows through) and carry an embedded `prefers-color-scheme` style, so they look right as static embeds too. Editable stroke data rides along in `<desc id="pz-data">`.
- Resize a zone with the three dots at its bottom; the height is written back to the block.

## Limits

- No PencilKit: Obsidian plugins run in a webview, so the toolbar is custom.
- No pressure-sensitive width.
- `touch-action: none` on canvases: the pen never scrolls the note mid-stroke, but finger-scroll starts outside a canvas.
- Reading-view moves rely on block matching; exotic markdown (HTML blocks with blank lines, footnotes) can land a block off.

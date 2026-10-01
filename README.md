# Pencil Zones (v0.5.0)

Inline Apple Pencil drawing zones for Obsidian.

## Use

1. Enable `Pencil Zones` in Settings → Community plugins.
2. Command palette → `Insert drawing zone`.
3. Draw inline with Pencil or mouse. **Fingers never draw** (gestures / moving only).

## Behavior

- **Inline live canvas** (transparent background: your light/dark theme shows through), resizable via three gray dots at the bottom (150–1200px, saved to `height:`).
- **Move zones**: single-finger long-press a zone (not the dots) → it lifts; drag it before/after text or other content with a blinking text-cursor previewing the landing spot (edge auto-scroll included). Release to drop. The fence text is verified before rewriting, so a stale mapping aborts instead of corrupting the note.
- **One global toolbar**: bottom-right by default, drag it by the `⋯` strip on top; it snaps to the nearest side (left/right) on release and remembers its spot. Only appears when the current note has a zone; hides on keyboard typing. Active zone gets an accent outline.
  - Dynamic `ink` swatch (black on light, white on dark) + yellow/red/green/blue squares, tools `✏️ 🖍️ 🧽 🧼`, `📏` lines.
  - Controls are plain divs: taps never steal editor focus.
- **Gestures** (document-level touch tracking, 800ms / 30px-per-finger tolerance): **2-finger tap = undo**, **3-finger tap = redo**. Plus `Undo stroke` / `Redo stroke` commands.
- **Erasers**: `🧽` whole line, `🧼` pixel (small round bite, splits lines, cursor ring).
- **Ruled lines**: `📏` toggles theme-aware lines per zone, persisted (`lines:`) + in SVG.
- **Storage**: transparent standalone SVG in `_inline_handwriting` (configurable), `{Note}-{timestamp}-{rand}.svg`. Dynamic ink + lines adapt via embedded `prefers-color-scheme` style even in static embeds. Stroke data in `<desc id="pz-data">`.
- **Widths hardcoded**: pencil 2, highlighter 28 @ 0.35, pixel eraser radius 10.

Inline Apple Pencil drawing zones for Obsidian.

## Use

1. Enable `Pencil Zones` in Settings → Community plugins.
2. Command palette → `Insert drawing zone`.
3. Draw inline with Pencil or mouse. **Fingers never draw** (gestures only).

## Behavior

- **Inline live canvas** (transparent background: your light/dark theme shows through), resizable via `↕️` handle (150–1200px, saved to `height:`).
- **One global toolbar**: two columns (colors | tools), anchored just above the active drawing — never over the file explorer. Only appears when the current note has a zone; hides on keyboard typing. Active zone gets an accent outline.
  - Dynamic `ink` swatch (black on light, white on dark — icon shifts with theme) + 🟨🟥🟩🟦 squares, tools `✏️ 🖍️ 🧽 🧼`, `📏` lines.
  - Controls are plain divs: taps never steal editor focus.
- **Gestures** (document-level touch tracking, 800ms / 30px-per-finger tolerance): **2-finger tap = undo**, **3-finger tap = redo**. Plus `Undo stroke` / `Redo stroke` commands (desktop parity).
- **Erasers**: `🧽` whole line, `🧼` pixel (small round bite, splits lines, cursor ring).
- **Ruled lines**: `📏` toggles theme-aware lines per zone, persisted (`lines:`) + in SVG.
- **Storage**: transparent standalone SVG in `_inline_handwriting` (configurable), `{Note}-{timestamp}-{rand}.svg`. Dynamic ink + lines adapt via embedded `prefers-color-scheme` style even in static embeds. Stroke data in `<desc id="pz-data">`.
- **Widths hardcoded**: pencil 2, highlighter 28 @ 0.35, pixel eraser radius 10.

Inline Apple Pencil drawing zones for Obsidian.

## Use

1. Enable `Pencil Zones` in Settings → Community plugins.
2. Command palette → `Insert drawing zone`.
3. Draw inline with Pencil or mouse. **Fingers never draw** (gestures only).

## Behavior

- **Inline live canvas**, resizable via `↕️` handle at the bottom (150–1200px, saved back to the block's `height:`).
- **One global toolbar**, fixed bottom-right, controls all zones. It only appears when the current note contains a drawing zone, shows on pen/mouse contact, hides when you type. Active zone gets an accent outline.
  - Tools `✏️` pencil, `🖍️` highlighter, `🧽` object eraser (whole line), `🧼` pixel eraser (small round bite, splits lines, with cursor ring) + 6 solid color squares + `📏` lines.
  - Controls are plain divs: taps can never steal editor focus or flip a block back to source text.
- **Gestures** (document-level Pointer Events, each finger tracked against its own start): single tap with **2 fingers = undo**, **3 fingers = redo**. Multi-touch cancels any in-progress stroke. No buttons, no popups.
- **Ruled lines**: `📏` toggles light lines (32px) on the active zone, persisted per zone (`lines: true/false`) + in the SVG. Setting controls the default for new zones.
- **Storage**: standalone SVG in configurable root folder (default `_inline_handwriting`), named `{Note}-{timestamp}-{rand}.svg`. Note stores:
  ````md
  ```pencil-draw
  src: _inline_handwriting/Note-20260101....svg
  height: 300
  lines: false
  ```
  ````
  The SVG is viewable as an image even without the plugin; stroke data is embedded in `<desc id="pz-data">` for re-editing.
- **Widths hardcoded**: pencil 2, highlighter 28 @ 0.35 opacity, pixel eraser radius 10, no width selector.

Inline Apple Pencil drawing zones for Obsidian.

## Use

1. Enable `Pencil Zones` in Settings → Community plugins.
2. Command palette → `Insert drawing zone`.
3. Draw inline with Pencil or mouse. **Fingers never draw** (tap/scroll only).

## Behavior

- **Inline live canvas**, resizable via `↕️` handle at the bottom (150–1200px, saved back to the block's `height:`).
- **One global toolbar**, fixed bottom-right, controls all zones. Active zone gets an accent outline.
  - Tools `✏️` pencil, `🖍️` highlighter, `🧽` eraser + 6 solid color squares + `↩️ ↪️ 🗑️ 📏`.
  - Controls are plain divs: taps can never steal editor focus or flip a block back to source text.
  - Shows on pen/mouse contact with any zone, hides when you type via keyboard.
- **Gestures** (Pointer Events, no passive touch listeners): single tap with **2 fingers = undo** (`↩️`), **3 fingers = redo** (`↪️`). Multi-touch cancels any in-progress stroke.
- **Ruled lines**: `📏` toggles light lines (32px) on the active zone, persisted per zone (`lines: true/false`) + in the SVG. Setting controls the default for new zones.
- **Storage**: standalone SVG in configurable root folder (default `_inline_handwriting`), named `{Note}-{timestamp}-{rand}.svg`. Note stores:
  ````md
  ```pencil-draw
  src: _inline_handwriting/Note-20260101....svg
  height: 300
  lines: false
  ```
  ````
  The SVG is viewable as an image even without the plugin; stroke data is embedded in `<desc id="pz-data">` for re-editing.
- **Widths hardcoded**: pencil 2, highlighter 28 @ 0.35 opacity, no width selector.

## Notes / limits

- No native PencilKit `PKToolPicker`: Obsidian plugins run in a webview, so this is a custom toolbar.
- No pressure-sensitive width.
- Canvas uses `touch-action: none`: pen always draws (no scroll hijack), but finger scroll over a canvas is blocked — scroll from text areas.
- Background is white, so white acts like correction/white-out.

## Notes / limits

- No native PencilKit `PKToolPicker`: Obsidian plugins run in a webview, so this is a custom floating toolbar (as agreed).
- No pressure-sensitive width (as agreed).
- Background is white, so `⚪` white acts like correction/white-out on the canvas.
- Desktop: mouse draws too (for testing).

## Dev → test loop

- Source: `~/dev/obsidian-pencil-zones/`
- Test install: `<vault>/.obsidian/plugins/pencil-zones/` (copy `manifest.json`, `main.js`, `styles.css`, then reload Obsidian).

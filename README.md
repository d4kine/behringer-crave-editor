# CRAVE EDITOR - Grid Pattern Editor

### ▶ [Open the live app](https://d4kine.github.io/behringer-crave-editor/)

Runs entirely in your browser without install. Use **Chrome or Edge** for the live Web MIDI / SysEx features.

A browser-based piano-roll pattern editor for the **Behringer Crave**. Draw a sequence in
the grid, then export it as a SynthTribe `.seq` file, a byte-exact `.syx` SysEx dump, or
send it straight to the hardware over **Web MIDI**. The Crave can then sequence a Behringer
Edge over MIDI - no computer needed at playback time.

No build step, no dependencies: it is plain HTML + CSS + ES modules.

## Features

- Two tools (press **B** to switch): **Select** drags a marquee to pick notes, drag the body
  to move, drag the right edge to extend (tie); **Edit** is a pencil - click or drag on empty
  steps to paint notes, click or drag over a note to erase it. Double-click or right-click
  deletes in either tool. Monophonic (one note per step), like the Crave.
- Per-note inspector: gate, ratchet (×1-×4), glide, accent.
- Pattern length (1-32 steps) and swing.
- Undo/redo, copy/cut/paste, arrow-key nudge, randomize, clear.
- Import: Standard MIDI files (`.mid`), `.syx`/`.seq` dumps, and saved JSON projects. MIDI files
  longer than the Crave's 32 steps open a visual range picker - slide and resize a window over a
  mini-timeline to choose exactly which bars/steps to import.
- Export: `.seq` (SynthTribe), `.syx` (opcode 0x78, verified byte-for-byte against real
  captures in [`sysex/`](sysex/)), and JSON projects.
- Live MIDI: connect, write a pattern to a Bank/Pattern slot, read an incoming dump, plus a
  raw SysEx monitor.

The protocol details and hardware notes are in
[`BEHRINGER_CRAVE_SYSEX.md`](BEHRINGER_CRAVE_SYSEX.md) and [`INFO.md`](INFO.md).

## Run locally

ES modules require HTTP - opening `index.html` via `file://` will not work. Serve the folder
with any static server:

```sh
bunx serve .
# or: python3 -m http.server 8000
```

Then open the printed URL (e.g. `http://localhost:3000` or `http://localhost:8000`).
Web MIDI / SysEx features need Chrome or Edge and permission to use SysEx.

## Project structure

```
index.html         markup + asset links
css/styles.css     all styling
js/
  state.js         protocol constants + shared state + DOM/util helpers
  protocol.js      .seq / .syx encode + decode (byte-exact)
  grid.js          piano-roll rendering, inspector, pointer interaction
  history.js       undo/redo, clipboard, nudge
  midi-file.js     Standard MIDI File (.mid) import + range picker
  webmidi.js       Web MIDI + SysEx I/O
  main.js          entry point: seeds demo, wires DOM, first render
```

## Deploy to GitHub Pages

1. Initialize and commit:
   ```sh
   git init
   git add .
   git commit -m "Modularize CRAVE EDITOR"
   ```
2. Create the repo and push (GitHub CLI):
   ```sh
   gh repo create crave-sequenceeditor --public --source=. --push
   ```
   Or create it on github.com, then:
   ```sh
   git remote add origin https://github.com/<user>/crave-sequenceeditor.git
   git branch -M main
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source: _Deploy from a branch_ →
   Branch: `main` / `(root)` → Save**.
4. After ~1 minute the site is live at
   `https://<user>.github.io/crave-sequenceeditor/`. Because it is served over HTTPS, the
   Web MIDI / SysEx features work in production (Chrome/Edge).

All asset paths are relative, so the app works correctly under the project sub-path.

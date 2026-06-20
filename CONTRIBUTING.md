# Contributing to CRAVE EDITOR

Thanks for taking the time to contribute. This is a small, dependency-free browser tool, so the
bar for getting started is low - but the SysEx protocol work has strict rules. Please read this
before opening a pull request.

## Ground rules

- **No build step, no dependencies.** The app is plain HTML + CSS + vanilla ES modules. Do not add
  a bundler, framework, or npm/bun/pnpm packages. If a tooling task ever needs a package manager,
  use [`bun`](https://bun.sh) (never `npm` or `pnpm`).
- **UI strings are English.** Match the surrounding tone.
- **Use a plain hyphen `-` in prose and docs, never the em dash character.**
- Keep changes focused. One topic per pull request makes review fast.

## Project layout

There are two parallel codebases - see [`CLAUDE.md`](CLAUDE.md) for the full picture:

- `index.html` + `css/styles.css` + `js/*.js` - the modular ES-module app served by GitHub Pages.
- `crave-seq-grid.html` - the original single-file version, and currently the **source of truth for
  protocol bytes** until the verified codec is ported into `js/`.

The module map:

```
js/state.js       protocol constants + shared state + helpers
js/protocol.js    .seq / .syx encode + decode
js/grid.js        piano-roll rendering, inspector, pointer
js/history.js     undo/redo, clipboard, nudge
js/midi-file.js   Standard MIDI File (.mid) import + range picker
js/webmidi.js     Web MIDI + SysEx I/O
js/main.js        entry point + wiring
```

## Running locally

ES modules require HTTP - opening `index.html` via `file://` will not work. Serve the folder:

```sh
bunx serve .
# or: python3 -m http.server 8000
```

Then open the printed URL. Web MIDI / SysEx features need **Chrome or Edge** and SysEx permission.
The single-file `crave-seq-grid.html` opens directly from `file://`.

## The SysEx protocol - never guess bytes

The byte-level spec lives in [`BEHRINGER_CRAVE_SYSEX.md`](BEHRINGER_CRAVE_SYSEX.md). The cardinal
rule: **never invent or guess protocol bytes.** Anything not confirmed from a real capture must be
either flagged with a clearly-labeled constant or preserved verbatim and round-tripped untouched
(for example the unknown effect bit `0x08`). If you lack data, ask for a labeled capture instead of
inventing a mapping.

### Verifying a codec change

Any change to the codec must round-trip byte-for-byte against the real captures in `sysex/`:

- **Golden source:** `sysex/cravde-full-dump.syx` is 64 concatenated `78` messages. Decoding then
  re-encoding every frame must reproduce it byte-identically.
- **`.sqs`:** importing a slot from `sysex/crave-dump.sqs` and rebuilding the set must match.
- **Settings:** the `76` frame decodes to pitch-bend 12, accent threshold 127.
- Also `node --check` any inline JS and confirm every `$("id")` resolves to a DOM node.

## Submitting changes

1. Fork and branch off `main`.
2. Make your change and verify it (round-trip the codec if you touched the protocol).
3. Keep commits clear and scoped; reference any related issue.
4. Open a pull request describing what changed and how you verified it. For protocol changes,
   attach or reference the capture you validated against.

## Reporting bugs and ideas

Open an issue with steps to reproduce, your browser/OS, and - for protocol bugs - a labeled SysEx
capture if you can provide one. Captures are the most valuable thing you can contribute, since they
let us confirm bytes instead of guessing.

## Support the project

CRAVE EDITOR is free and open source. If it saved you time, you can support development on
[Ko-fi](https://ko-fi.com/d4kine) or [Buy Me a Coffee](https://buymeacoffee.com/d4kine).
Contributions of code, captures, and bug reports are just as welcome.

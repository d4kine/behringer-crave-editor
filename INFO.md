# INFO.md — Crave Pattern Tool (Behringer Crave → Edge)

Handoff doc for continued development (e.g. with Claude Code). Everything here was
verified against manuals, a reverse-engineering repo, and Behringer's documented MIDI
implementation. Where something is **unverified**, it says so explicitly — please confirm
on real hardware before relying on it.

---

## 1. Goal

Build patterns in a clean web UI and get them playing on a **Behringer Crave**, which then
sequences a **Behringer Edge** over MIDI. The whole thing must run **without a computer at
playback time** — the pattern lives in the Crave's internal memory.

The user's pain points with stock tooling: SynthTribe's sequencer is clumsy, has no MIDI-file
import, and hand-entering patterns is tedious.

---

## 2. Hardware facts (verified — read this before designing anything)

### Behringer Edge
- DFAM-style semi-modular analog **percussion synth, monophonic** (one voice).
- USB **class-compliant MIDI**; responds to **MIDI note input** (note number → oscillator
  pitch, velocity → dynamics). Can be played from a keyboard/DAW/sequencer.
- Its sequencer is **physical analog pitch + velocity knobs** (two rows of 8). There is
  **NO pattern memory, NO software-settable steps, NO SysEx pattern storage**.
  → You **cannot** transfer/store a sequence into the Edge. It can only be driven live by
  MIDI notes, or its knobs turned by hand.
- Tempo over MIDI/USB clamped **10–300 BPM** (only relevant if syncing its internal seq via clock).

### Behringer Crave  ← this is where patterns are stored
- Monophonic analog synth (3340 VCO, ladder filter). Class-compliant USB MIDI.
- **32-step sequencer**, 4 pages × 8 steps. **64 storable patterns** (8 banks × 8).
- Per-step features: note, **rest**, **gate length 1–8 (8 = tie)**, **ratchet**, **glide**,
  **accent**. Global **swing**. Plays standalone; **MIDI OUT can sequence the Edge**.
- SynthTribe / SynthTool has a **Sequencer page** that **imports `.seq` files** and writes
  them to a slot via **Store** (USB SysEx). This is the bridge we currently use.

### Architecture decision (why)
- Edge can't store patterns → **Crave is the brain**. Crave holds the pattern, plays
  standalone, and drives the Edge: **Crave MIDI OUT → Edge MIDI IN**, same MIDI channel.
- Edge is monophonic → one Crave voice maps perfectly. **One note per step** in the editor.

---

## 3. The Crave `.seq` file format (EXACT — this is the core asset)

Reverse-engineered in **`claziss/CraveSeq`** (GPL-3.0): https://github.com/claziss/CraveSeq
Our tool reproduces this format byte-for-byte. SynthTribe/SynthTool reads `.seq` and does the
actual USB SysEx transfer to a slot on **Store**.

### Layout
```
Offset  Size  Field
------  ----  -----------------------------------------------------------
0x00    32    Fixed header (see below)
0x20     2    unk0 = 00 00
0x22     2    byte-length (big-endian) = 0x0E + (length-1)*8   (= 6 + 8*length)
0x24     2    swing = [MSB, LSB]; value = MSB*16 + LSB; swing% = 50 + value
0x26     4    seq length = [00, HI, 00, LO]; steps = HI*8 + LO + 1
0x2A   8*N    N = step count, 8 bytes per step (see below)
```

### Fixed 32-byte header (literal bytes)
```
23 98 54 76 00 00 00 0A 00 43 00 52 00 41 00 56   "....C.R.A.V"
00 45 00 00 00 0A 00 31 00 2E 00 31 00 2E 00 31   ".E....1...1...1"   (= "CRAVE" + "1.1.1")
```
(The reference parser only validates the first 18 bytes and ignores the version; we still
write all 32 verbatim to be safe.)

### Per-step record (8 bytes)
```
Byte  Field          Encoding
----  -------------  --------------------------------------------------
0-1   note           value = MSB*16 + LSB  (MIDI note number; C-1 = 0, C4 = 60)
2     gate length    0–7   (UI 1–8 maps to 0–7; 7 = TIE to next step)
3     ratchet        0–3   (UI ×1–4 maps to 0–3)        [SEE WARNING #3]
4-5   velocity       value = MSB*16 + LSB  (Crave has no per-step velocity;
                                            we write fixed 04 00 = 64)
6     effects        bitfield: 0x01 glide | 0x04 accent | 0x08 rest(step off)
7     unk            00
```

### Decoders (for reference / round-trip)
```
note     -> octave = note/12 - 1 ;  noteNo = note % 12
velocity -> MSB*16 + LSB
swing%   -> 50 + (MSB*16 + LSB)
steps    -> (lenByte[1]*8 + lenByte[3]) + 1
```

### Multi-step (tied) note mapping used by our editor
A note of length L at pitch P starting at step `s`:
- step `s` (trigger): note=P, ratchet/glide/accent from the note, gate = 8 (tie) if L>1 else note's gate.
- steps `s+1 .. s+L-2`: note=P, gate=8 (tie), ratchet=1, glide/accent off.
- step `s+L-1` (last): note=P, gate = note's gate, ratchet=1, glide/accent off.
- empty steps: effects bit 0x08 (rest). Rest steps still carry a note byte (ignored) — we
  propagate the last used note value so the bytes stay valid.

> **Licensing note:** the *format knowledge* comes from a GPL-3.0 repo. We reimplemented the
> byte layout from its documentation/structs in our own code; if any GPL code is copied
> verbatim, the GPL applies. Keep our implementation independent or respect GPL terms.

---

## 4. Crave SysEx protocol (documented — needed for "direct" write, Option 2)

From the Crave Quick Start Guide MIDI implementation:
```
Manufacturer ID : 00 20 32        (Behringer / Music Tribe)
Device ID       : 00 01 05        (CRAVE)
Message form    : F0 00 20 32 00 01 05 <PKT> [<SPKT>] <D0..Dn> F7
Known examples  : Set MIDI Clock  = F0 00 20 32 00 01 05 17 D0 F7
                  Set Assign Mode = ... D0 = 0x00–0x0F
                  Pitch-bend range= ... D0 = 0x00–0x0C semitones
```
**RESOLVED (from hardware captures):** the pattern transfer command is opcode **`0x78`**
(`F0 00 20 32 00 01 05 78 <bank> <pattern> <swing×2> <seqlen> <32×8 steps> F7`), and **store** =
that `78` followed by a **`01 00 00` commit**. The on-wire payload is NOT the raw `.seq` file — it is
already nibble-encoded (every byte ≤ 0x7F). Full byte-level spec, settings (`0x76`) and `.sqs` format:

> **See `BEHRINGER_CRAVE_SYSEX.md`** — the reverse-engineering reference, now verified byte-for-byte
> against a full 64-pattern device dump. Still open: the meaning of effect bit `0x08` and the
> host→Crave read *request* opcode. The grid tool's **SysEx monitor** is the capture tool for those.

---

## 5. Current code state

All files are **single-file, vanilla JS/HTML/CSS, no build step, no dependencies**. Open in a
browser. Crave-inspired palette (graphite panel, red `#ff3b2f` step LEDs, light silkscreen
legends; Oswald + JetBrains Mono fonts via Google Fonts with system fallbacks).

| File | Purpose | Status |
|------|---------|--------|
| `crave-seq-grid.html` | **Main (and only) tool.** Ableton-style piano-roll grid (C1–C6), mono (one note/step). Click=place, drag right edge=lengthen (tie), drag body=move, dblclick/right-click=delete. Inspector for gate/ratchet/**velocity**/glide/accent. Accent lane. Swing + length. **Exports `.seq`, `.syx`, `.sqs`.** Undo/redo, copy/cut/paste, arrow-nudge, project save/load (JSON). MIDI-file import. Web MIDI panel: device pickers, SysEx monitor, import `.syx`/`.sqs`/full-dump/`.seq`, **direct Write/Read to Crave** (78 + `01 00 00` commit), **settings read** (config 76). | Pattern codec verified byte-for-byte vs a full 64-pattern hardware dump (incl. velocity, glide=01, accent=04, swing, ratchet) |
| `crave-seq.html` | Listed historically; **does not exist** in the repo. | n/a |
| `edge-seq.html` | Listed historically; **does not exist** in the repo. | n/a |

Key functions in `crave-seq-grid.html`:
- `computeSteps()` — flattens the note-event list into the per-step model (applies tie logic).
- `buildSeqBody()` / `buildSeq()` — emit the `.seq` body / full file. `buildSeqBody()` also feeds `.syx` and live SysEx.
- `decodeSeqBody()` — inverse of the above: parses a body back into the note model (reverses the tie logic). Verified by an offline encode→decode round-trip.
- `parseMidi()` — minimal Standard MIDI File parser (note on/off, running status, VLQ).
- pointer handlers on `#grid` — create/move/resize; `resolveOverlaps()` enforces mono.
- `connectMidi()`/`populatePorts()`/`sendBytes()` — Web MIDI plumbing; `onMidiMessage()`/`logSysex()` — SysEx monitor + read decode.
- SysEx constants (`MIDI_HDR`, `OP_STORE`, `OP_REQUEST`, `STORE_PREFIX_AFTER_SLOT`, `PAYLOAD_INCLUDES_HEADER`, `READ_PAYLOAD_OFFSET`) — the single point to correct after hardware capture. See **`BEHRINGER_CRAVE_SYSEX.md`**.

Editor constraints to know:
- Pitch range in UI: **C2–C5** (MIDI 36–72). Wider range via the Crave's octave switches.
- **One note per step** is enforced by design (Crave/Edge are monophonic) — not a bug.
- Swing UI 50–75% (50 = straight). Length 1–32.

---

## 6. Web MIDI constraints (important for Options 2 & 4)

- **Chrome / Edge only** (Firefox unreliable, Safari unsupported).
- Must run as a **top-level page** (`file://`, `localhost`, or `https`). Web MIDI is **blocked
  inside sandboxed iframes** (e.g. the artifact/preview pane). Ship as a standalone file.
- **SysEx** needs `navigator.requestMIDIAccess({ sysex: true })` + user permission.
- Plain **note** messages need no sysex permission.
- Crave & Edge are class-compliant USB MIDI → appear automatically, no drivers.

---

## 7. Roadmap / open tasks

Ordered by value:

1. **Hardware round-trip verification** of `.seq` (do this first):
   export a tiny pattern → SynthTribe Sequencer → Import → Store → check on the Crave:
   - octave correct? (note byte = MIDI number, C4=60)
   - tie (gate 8) behaves as a held note?
   - accent / glide land on the right step?
   - swing direction/amount correct?
   Adjust the mapping in `buildSeq()`/`computeSteps()` if anything is off.

2. **Direct write/read (Option 2/3) — DONE & format VERIFIED.** Reverse-engineered from real
   captures (`sysex/*.syx`, `crave-dump.sqs`, full 64-pattern dump): pattern transfer is opcode
   **`0x78`** (273 bytes); store = `78` then **`01 00 00` commit**. `buildCraveSysex`/`decodeCraveSysex`
   round-trip **all 64 patterns of a full device dump byte-identically**, including velocity, swing,
   ratchet, gate, glide=`0x01`, accent=`0x04`. `.syx`/`.sqs`/full-dump/`.seq` import, `.syx`/`.sqs`
   export, **An Crave senden** (78+commit, overwrite confirm), **Von Crave lesen** (auto-loads any
   incoming `78`), and **settings read** (config `0x76`: pitch-bend + accent threshold confirmed) all work.
   **Still open (preserved/flagged, never guessed — see `BEHRINGER_CRAVE_SYSEX.md` §7):** the meaning
   of per-step effect bit `0x08` (distinct from glide/accent; preserved verbatim), and the host→Crave
   read *request* opcode (read works via auto-load/import instead).

3. **Option 4 test (no SysEx):** check whether the Crave step-records **external** MIDI notes
   (manual only documents recording via its own 13 keys — *unverified* for MIDI IN).

4. **Editor features — DONE:** undo/redo, copy/cut/paste, Delete/Backspace, arrow-key nudge,
   save/load project as JSON, keyboard shortcuts (see the in-app help). **Still open:** per-step
   scale-lock; smarter MIDI import (tie detection from note duration, accent from velocity
   threshold); multi-pattern export if a format is known.

5. **Polychain / multiple patterns / song chaining** (later).

---

## 8. Known risks / things to double-check

1. `.seq` format is **community reverse-engineering, not official** — verify on hardware.
2. **Velocity bytes** (4-5) meaning is uncertain; we hardcode `04 00` (=64) like the reference.
   Accent is the Crave's real per-step dynamic.
3. **Ratchet encoding inconsistency** in the reference: its *parser* reads `raw + 1`, but its
   *writer* wrote `raw` directly. We write `raw = count-1` (count 1–4 → 0–3). **Confirm** which
   the device/SynthTribe expects.
4. **Crave pattern-store SysEx** command is unknown (see §4).
5. **Swing range / negative swing** unconfirmed; we use 50–75% (positive only) per the nibble
   encoding `swing-50`.
6. **Store overwrites** the target slot silently — always warn the user.

---

## 9. Sources

- `.seq` format: https://github.com/claziss/CraveSeq  (Crave + TD-3 SEQ parser, GPL-3.0)
- TD-3 MIDI / pattern dump (analogous device): https://303patterns.com/td3-midi.html
- TD-3 `.seq`/`.syx` generator precedent: https://github.com/echolevel/Acid-Injector
- Crave Quick Start Guide (MIDI impl, device id 00 01 05, sequencer ops): Behringer Crave QSG.
- Behringer SysEx prefix is `F0 00 20 32 ...` across the product line.

---

## 10. How to run / develop

No build. Open the `.html` file directly in **Chrome/Edge**. For features that talk to MIDI
(Options 2/4), it must be a top-level page (not an iframe) and you must grant MIDI/SysEx
permission. Everything is plain JS — edit and reload.

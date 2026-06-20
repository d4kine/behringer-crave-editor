# Behringer Crave - MIDI System Exclusive (SysEx) reference

Reverse-engineering reference for the Crave's SysEx, built from **real captures** (SynthTribe ↔ Crave,
in `sysex/`), the Behringer Crave Quick Start Guide, the product-line SysEx framework, and the TD-3.

The **pattern transfer format (opcode `0x78`) is fully reverse-engineered and verified byte-for-byte**:
the codec in `crave-seq-grid.html` decodes→re-encodes **all 64 patterns of a full device dump
identically**. The `.sqs` set format and the settings dump (`0x76`) are decoded too. A few small
unknowns remain (see §7) and are **preserved/flagged, never guessed**.

**Confidence labels:**
- ✅ **VERIFIED** - confirmed byte-for-byte from hardware captures (or a primary doc).
- 📄 **DOCUMENTED** - transcribed from the Crave QSG MIDI-implementation writeups; reconfirm
  against the official PDF before relying on it.
- ❓ **INFERRED / OPEN** - by analogy or not yet sampled; do not rely on it.

## 0. Opcodes at a glance

| Opcode | Direction | Meaning | Confidence |
|---|---|---|---|
| `78` | both | Pattern data (273 B) — store host→Crave, dump Crave→host | ✅ |
| `01 00 00` | host→Crave | Commit/store the just-sent `78` to its slot | ✅ |
| `76` | Crave→host | Configuration / settings dump | ✅ (anchors) |
| `75` | host→Crave | Request configuration dump | 📄 |
| `09` | both | Identity / version handshake (`09 00 01 01 04`) | ✅ seen, not decoded |
| `03` | both | Seen in launch handshake (`03 00`) | ❓ |
| `17`/`19`/`1A` | host→Crave | Set MIDI clock / clock edge / clock type | 📄 |
| `7D` | host→Crave | Restore factory settings | 📄 |
| `77` | host→Crave | Pattern dump **request** (single slot) | ❓ TD-3 analogy, unconfirmed |

All messages are framed `F0 00 20 32 00 01 05 <opcode> … F7` (§1).

---

## 1. Message framing ✅

```
F0  00 20 32  00 01 05  <CMD>  [<SUB>]  <D0..Dn>  F7
│   │         │         │               │         └ End of SysEx
│   │         │         │               └ command data bytes (each 0x00–0x7F)
│   │         │         └ command / opcode byte
│   │         └ Device ID = Crave model id  (00 01 05)
│   └ Manufacturer ID = Behringer / Music Tribe (00 20 32)
└ Start of SysEx
```

- **Manufacturer ID:** `00 20 32` (Behringer GmbH / Music Tribe) ✅
- **Crave Device/Model ID:** `00 01 05` ✅
  (compare: TD-3 = `00 01 0D` and, in the SynthTribe `.syx` transfer, `00 01 0A`; 2600 = `00 01 0B`)
- All data bytes must be 7-bit (`0x00–0x7F`); values > 127 are split MSB/LSB or nibble-encoded.

Behringer's generic line framing is sometimes written `F0 00 20 32 aa bb cc dd ee ff F7` where
`aa` is reserved, `bb` is the device id (`7F` = broadcast to all), `cc` = parameter, `dd` =
sub-parameter, `ee`/`ff` = value MSB/LSB. ✅

---

## 2. Configuration & system commands 📄

Transcribed from the Crave QSG MIDI implementation. Opcodes follow `F0 00 20 32 00 01 05`.
Reconfirm against the official PDF.

| Command | Opcode | Form | Data |
|---|---|---|---|
| Set MIDI Clock (BPM) | `17` | `… 17 D0 F7` | D0 = clock value |
| Set Clock Edge | `19` | `… 19 D0 F7` | D0: `00`=Fall, `01`=Rise |
| Set Clock Type | `1A` | `… 1A D0 F7` | D0: `00`=1PPS, `01`=2PPQ, `02`=24PPQN, `03`=48PPQN, `04`=CV |
| Set Assign Mode | (assign) | `… <op> D0 F7` | D0 = `00`–`0F` |
| Set Pitch-Bend Range | (pb) | `… <op> D0 F7` | D0 = `00`–`0C` semitones |
| Get Configuration Parameters | `75` | `… 75 F7` | (request; device replies with the config dump) |
| Restore Factory Settings | `7D` | `… 7D F7` | - |

### Set Configuration Parameters 📄
A single packed message carrying several globals (order as documented):

| Data | Meaning |
|---|---|
| D0–D1 | Pitch-bend range value |
| D2 | MIDI clock enable |
| D3 | Sequencer auto-play enable |
| D4 | Clock source |
| D5 | Clock type |
| D6 | Clock edge |
| D7 | Assign mode |
| D8 | Accent threshold |

### Get-style requests (TD-3 framework, substitute Crave id `00 01 05`) ❓
| Request | Bytes |
|---|---|
| Get model | `F0 00 20 32 00 01 05 00 04 F7` |
| Get firmware version | `F0 00 20 32 00 01 05 00 08 F7` |
| Get configuration | `F0 00 20 32 00 01 05 00 75 F7` → response `… 00 76 … F7` |

> Note: the Crave is an **analog** semi-modular - knob/patch state is **not** stored or recalled.
> "Configuration parameters" here are global MIDI/clock/sequencer settings, not the sound patch.

---

## 3. Sequencer pattern transfer (store / dump) ✅ CONFIRMED FROM CAPTURES

**This is now reverse-engineered byte-for-byte** from real `.syx` captures in `sysex/`
(`behringer_crave-load_bank1_pattern1`, `…pattern2`, `…bank2_pattern2`). The codec in
`crave-seq-grid.html` (`buildCraveSysex` / `decodeCraveSysex`) reproduces all three files
**byte-identically** (verified by an automated round-trip).

The Crave has **8 banks × 8 patterns** (64 slots). One message, opcode **`0x78`**, carries a full
pattern; the same message is used both to **store** (host → Crave) and as the **dump** (Crave → host).

### Full 273-byte layout ✅
```
Offset  Size  Bytes / meaning
------  ----  ----------------------------------------------------------------
0       7     F0 00 20 32 00 01 05          header (mfr + Crave id)
7       1     78                            opcode = pattern data
8       1     <bank>     0x00–0x07          (UI bank 1–8, 0-indexed)
9       1     <pattern>  0x00–0x07          (UI pattern 1–8, 0-indexed)
10      2     <swing>    MSB LSB            value = MSB*16+LSB, swing% = 50+value   (50%=00 00, 75%=01 09) ✅
12      4     <seqlen>   00 HI 00 LO        active length = HI*8 + LO + 1
16      256   32 step records × 8 bytes     ALWAYS 32, regardless of length
272     1     F7
```
- **Always 32 step records** are sent. Steps beyond the active length are rests.
- `seqlen` examples (confirmed against active-step counts): `00 01 00 03`→12, `00 00 00 07`→8, `00 00 00 00`→1.

### Per-step record (8 bytes) ✅ — all fields confirmed from the full device dump
```
Byte  Field      Encoding                                            Confidence
----  ---------  --------------------------------------------------  ----------
0-1   note       MSB*16 + LSB (MIDI note; C4=60). Rests carry 48.    ✅
2     gate       0–7 → gate length 12.5%–100% (editor gate 1–8)      ✅ (3=50%, 7=100%)
3     ratchet    0–3 → ×1–4                                          ✅ (all four seen)
4-5   velocity   MSB*16 + LSB, 1–127 (default 64 = 04 00)            ✅ (values 33/64/73/107/127 in dump)
6     effects    glide = 0x01, accent = 0x04                         ✅ (labeled capture)
                 bit 0x08 = a separate, still-UNIDENTIFIED flag      ❓ preserved verbatim (note.effx)
7     on/rest    0x00 = active step, 0x0f = rest/empty               ✅
```

> NOTE — this on-wire format DIFFERS from the `.seq`-file layout in §4: the **rest flag is byte 7
> (`0x0f`)**, not byte 6, and byte 6 holds the effect bits. The wire sub-header is shorter
> (no `unk`/blocklen): just swing(2)+seqlen(4). The codec round-trips **all 64 patterns of a full
> device dump byte-identically.**

### Store workflow ✅
To persist a pattern to a slot, send the `78` message, **then** the commit:
```
F0 00 20 32 00 01 05  01 00 00  F7
```
(Proven by `recall_b1-p1_glide+accent.syx` = a `78` frame immediately followed by `01 00 00`.)
`writeToCrave()` sends both. A full dump (`cravde-full-dump.syx`) = 64 concatenated `78` messages.

### Tie / held notes
gate `8` (=100% gate length) on consecutive same-note steps = a held/tied run; the editor encodes a
multi-step note that way and `decodeCraveSysex` coalesces it back — but **only while note, velocity,
glide, accent and the preserved bits are identical**, so per-step velocity/effect variation (seen in
factory patterns) is never lost. (Editor limitation: one velocity per note, so authoring per-step
velocity inside a single held note isn't expressible — loading then re-saving normalizes it.)

---

## 4. `.seq` FILE format (SynthTribe Import) — separate from the wire format

Our `.seq` export (`buildSeqBody`/`decodeSeqBody`) targets SynthTribe's **Import** button and uses
the CraveSeq-derived file layout (32-byte `CRAVE_HEADER` + `unk` + blocklen + swing + seqlen +
8-byte steps, rest = byte-6 bit `0x08`). It is **not** byte-identical to the §3 wire format and is
not independently hardware-verified. For direct MIDI / `.syx`, the tool always uses the §3 wire
codec. Keep `.seq` only for the SynthTribe-Import workflow.

---

## 5. `.sqs` set file (64 patterns) ✅

A SynthTribe **Dump → Save** set file. Verified against `crave-dump.sqs` (re-export byte-identical):
```
0       32    header: 87 43 91 02 … "CRAVE" … "1.1.4"   (NB: different magic from the .seq CRAVE_HEADER)
32      274×64  one block per slot (bank0/pat0 … bank7/pat7)
```
Each 274-byte block:
```
0–9     10×00                        pad
10–11   01 06                        blocklen (= 0x0e + 31*8 = 262, always 32 steps)
12–13   swing (MSB LSB)              as §3
14–17   seqlen 00 HI 00 LO           as §3
18–273  256 step bytes               32 × 8, same per-step format as §3
```
`importSqs` loads the currently-selected slot; `buildSqs`/`exportSqs` splice the editor pattern into
that slot and keep the other 63 blocks from the imported set.

## 6. Settings / config dump, opcode `0x76` ✅ (anchors)

`behringer_crave-loading-settings-on-synthtribe-launch.syx` carries three frames on app launch:
```
F0 00 20 32 00 01 05  09  00 01 01 04  F7        identity/version (09)
F0 00 20 32 00 01 05  03  00  F7                 (03 — query/ack)
F0 00 20 32 00 01 05  76  0c 00 01 01 00 02 00 06 7f  F7   config dump (76)
```
Config data `D0..D8 = 0c 00 01 01 00 02 00 06 7f` vs the SynthTribe *General* page:
- **D0 = `0c` = Pitch-Bend Semitones (12)** ✅
- **D8 = `7f` = Accent-Velocity Threshold (127)** ✅
- middle bytes correlate to MIDI-Clock-Out / Seq-Auto-Sync / Clock-Source/Type/Edge / Assign — **provisional**.
Request the dump with `F0 00 20 32 00 01 05 75 F7` (documented `75`; `decodeConfig` parses the `76` reply).
Writing settings is not implemented (would need labeled before/after captures of each field).

## 7. Resolved store/commit + still-open items

- `01 00 00` (opcode `01`) = **store/commit** of the just-sent `78` to its slot ✅ (always follows a `78`).
- `09 00 01 01 04` (opcode `09`) = identity/version handshake on connect (not decoded; not needed).

**Still open (preserved/flagged, never guessed):**
- **Effect bit `0x08`** — a real per-step flag in factory patterns, distinct from glide(`0x01`)/accent(`0x04`).
  Preserved verbatim (`note.effx`). To identify: capture a pattern toggling each remaining Crave per-step
  option one at a time.
- **Read/recall REQUEST opcode** (host→Crave) — not cleanly captured (Recall only logged the `78` response).
  Read works by auto-loading any incoming `78` and by importing `.syx`/`.sqs` dumps; a one-click slot
  request stays best-effort (`OP_REQUEST` guess) until captured.

---

## 8. Captured files (`sysex/`) — what each contains

| File | Bytes | Content |
|---|---|---|
| `behringer_crave-load_bank1_pattern1.syx` | 273 | `78` dump, bank0/pat0 — 12-note pattern |
| `behringer_crave-load_bank1_pattern2.syx` | 273 | `78` dump, bank0/pat1 — 8 notes, effect bits on 2 steps |
| `behringer_crave-load_bank2_pattern2.syx` | 273 | `78` dump, bank1/pat1 — 1 active step |
| `cravde-full-dump.syx` | 17472 | **64 concatenated `78` messages** = full device dump (the golden round-trip source) |
| `crave-dump.sqs` | 17568 | `.sqs` set file = 32 B header + 64×274 B blocks (§5) |
| `recall_b1-p1_glide+accent.syx` | 284 | a `78` frame **then** `01 00 00` → proves the store-then-commit flow |
| `behringer_crave-loading-settings-on-synthtribe-launch.syx` | 41 | 3 frames: `09` identity, `03 00`, `76` config dump (§6) |
| `behringer_crave-write_bank1_*.syx` | 11 | all identical `01 00 00` — STORE sends only the commit (no data) |
| `behringer_crave-DUMP.syx` / `…read-request-opcode.syx` | 273 | `78` responses (bank0/pat0); the host→Crave *request* was not captured |
| `behringer_crave-load_synthtribe.syx` | 13 | `09 00 01 01 04` identity frame |
| `*.png` | - | SynthTribe GUI screenshots (sequencer inspector + General settings page) |

Gotcha learned: SynthTribe's **STORE** button transmits only `01 00 00` (commit) — the pattern data
is **not** in that capture. To capture pattern data, use **Dump/Export** (`78` / `.sqs`), not Store.

## 9. Effect bit `0x08` — what we know (open)

The labeled capture (glide on note 1 → byte6 `0x01`; accent on note 2 → byte6 `0x04`) pins glide and
accent. A **third** byte6 bit, `0x08`, appears on active notes in several factory patterns and was
present on pattern 7's steps before the glide/accent edit. It is **not** glide and **not** accent.
The SynthTribe per-step inspector exposes Gate / Ratchet / Velocity / Glide / Accent / Rest — all of
which are otherwise accounted for — so `0x08` may be an internal/extra flag. Until a labeled capture
isolates it, the tool sets it never and **round-trips it verbatim** (`note.effx`).

---

## 10. Sources

- Behringer Crave Quick Start Guide - MIDI implementation (manufacturer/model id, channel
  messages, clock/config commands). Official PDF / ManualsLib (Crave manual, MIDI pages).
- Behringer product-line SysEx framing (`F0 00 20 32 …`, device id `7F` broadcast, param/value bytes).
- TD-3 MIDI implementation (analogous pattern dump `77`/`78`): https://303patterns.com/td3-midi.html
- `.seq`/`.syx` body format & raw-payload transfer: https://github.com/echolevel/Acid-Injector
- `.seq` reverse-engineering precedent: https://github.com/claziss/CraveSeq

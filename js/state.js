"use strict";

// ===================== Crave SysEx / .seq protocol constants =====================
// See BEHRINGER_CRAVE_SYSEX.md for the full reverse-engineering notes.
export const CRAVE_HEADER = [
  0x23,0x98,0x54,0x76,0x00,0x00,0x00,0x0a, 0x00,0x43,0x00,0x52,0x00,0x41,0x00,0x56,
  0x00,0x45,0x00,0x00,0x00,0x0a,0x00,0x31, 0x00,0x2e,0x00,0x31,0x00,0x2e,0x00,0x31 ];

// CONFIRMED byte-for-byte from real SynthTribe/Crave captures (sysex/*.syx):
//   F0 00 20 32 00 01 05  78  <bank> <pattern>  <swing×2> <seqlen: 00 HI 00 LO>  <32×8 step bytes>  F7
export const MIDI_HDR   = [0xF0,0x00,0x20,0x32,0x00,0x01,0x05]; // mfr 00 20 32 + Crave device 00 01 05
export const OP_PATTERN = 0x78;                 // pattern data (store host→Crave AND dump Crave→host)
export const REST_FLAG  = 0x0f;                 // per-step byte 7: 0x00 = active, 0x0f = rest/empty
export const REST_NOTE  = 48;                    // rest records always carry note 48 (0x30)
// Per-step effect byte (index 6). Bit 0x08 IS used by active notes in the captures; whether it
// is ACCENT or GLIDE is NOT yet confirmed (no labeled capture) — provisional, flip if needed:
export const WIRE_ACCENT = 0x08;                 // PROVISIONAL (the only effect bit seen in captures)
export const WIRE_GLIDE  = 0x01;                 // PROVISIONAL (never observed in captures yet)
// Dump/recall REQUEST opcode (Crave→host read trigger) is NOT yet captured. Reads work by
// listening for any incoming 78; this request is a best effort and easy to correct once known.
export const OP_REQUEST = 0x77;                  // UNCONFIRMED — request a pattern dump

// Cell sizes are zoomable: CW/CH are live `let` bindings (imported modules see the updated value).
export const CW_BASE = 40, CH_BASE = 16;
export let CW = CW_BASE, CH = CH_BASE;
export function setZoom(z){
  state.zoom = clamp(z, 0.4, 3);
  CW = Math.max(8, Math.round(CW_BASE * state.zoom));
  CH = Math.max(7, Math.round(CH_BASE * state.zoom));
}
export const PTOP = 84, PBOT = 24;            // C6..C1 (real Crave patterns use notes below C2, e.g. F1=29)
export const ROWS = PTOP - PBOT + 1;
export const NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

// Scale presets (semitone offsets from the root). "chromatic" = no constraint.
export const SCALES = {
  chromatic:  {label:"Chromatic", set:[0,1,2,3,4,5,6,7,8,9,10,11]},
  major:      {label:"Major",     set:[0,2,4,5,7,9,11]},
  minor:      {label:"Natural Minor", set:[0,2,3,5,7,8,10]},
  harm_minor: {label:"Harmonic Minor", set:[0,2,3,5,7,8,11]},
  dorian:     {label:"Dorian",    set:[0,2,3,5,7,9,10]},
  phrygian:   {label:"Phrygian",  set:[0,1,3,5,7,8,10]},
  lydian:     {label:"Lydian",    set:[0,2,4,6,7,9,11]},
  mixolydian: {label:"Mixolydian", set:[0,2,4,5,7,9,10]},
  pent_major: {label:"Major Pentatonic", set:[0,2,4,7,9]},
  pent_minor: {label:"Minor Pentatonic", set:[0,3,5,7,10]},
  blues:      {label:"Blues",       set:[0,3,5,6,7,10]},
};

// ===================== shared mutable state =====================
// One object whose *properties* are mutated by every module; the binding itself is never
// reassigned, so all modules see the same live values.
export const state = {
  length: 16,
  swing: 50,
  uid: 1,
  zoom: 1,              // grid zoom factor (scales CW/CH)
  mode: "select",       // tool mode: "select" (marquee) | "edit" (paint notes)
  randRoot: 60,         // absolute MIDI pitch (C4) the random generator builds from
  scaleRoot: 0,         // 0..11 (C..B)
  scaleType: "chromatic", // key into SCALES; constrains pitch of newly drawn/edited notes
  selIds: [],           // ids of all currently selected notes (multi-select)
  notes: [],            // {id,start,len,pitch,gate,ratchet,glide,accent}
  undoStack: [],
  redoStack: [],
  clipboard: null,      // {notes:[...], anchor} - group clipboard
};
export const UNDO_MAX = 100;

// ===================== pure helpers =====================
export const noteName = n => NAMES[n%12] + (Math.floor(n/12) - 1);
export const isBlack = n => [1,3,6,8,10].includes(((n%12)+12)%12);
export const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
export const byId = id => state.notes.find(n=>n.id===id);

// ===================== scale helpers =====================
// pitch class (0..11) belongs to the active scale?
export const inScale = p => {
  const sc = SCALES[state.scaleType]; if(!sc || state.scaleType==="chromatic") return true;
  return sc.set.includes((((p - state.scaleRoot) % 12) + 12) % 12);
};
// snap a pitch to the nearest in-scale pitch (no-op for chromatic), clamped to range
export const snapPitch = p => {
  const sc = SCALES[state.scaleType]; if(!sc || state.scaleType==="chromatic") return p;
  let best = p, bestD = Infinity;
  for(let o=-1;o<=1;o++) for(const d of sc.set){
    const base = state.scaleRoot + d + 12*(Math.floor((p - state.scaleRoot)/12) + o);
    const dist = Math.abs(base - p);
    if(dist < bestD){ bestD = dist; best = base; }
  }
  return clamp(best, PBOT, PTOP);
};

// ===================== selection helpers =====================
export const isSel       = id  => state.selIds.includes(id);
export const selNotes    = ()  => state.selIds.map(byId).filter(Boolean);
export const selPrimary  = ()  => state.selIds.length ? byId(state.selIds[state.selIds.length-1]) : null;
export const selectOnly  = id  => { state.selIds = id==null ? [] : [id]; };
export const selectSet   = ids => { state.selIds = [...new Set(ids)]; };
export const selectToggle= id  => { const i=state.selIds.indexOf(id); i<0 ? state.selIds.push(id) : state.selIds.splice(i,1); };

// ===================== DOM / IO helpers =====================
export const $ = id => document.getElementById(id);

export function fnameSafe(){ return ($("fname").value||"crave-pattern").trim().replace(/[^\w\-]+/g,"_")||"crave-pattern"; }

export function download(bytes,name){
  const blob=new Blob([bytes],{type:"application/octet-stream"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a");
  a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}

let msgTimer=null;
export function setMsg(t,k){ const m=$("msg"); m.textContent=t; m.className="msg "+(k||"");
  clearTimeout(msgTimer); if(k==="ok") msgTimer=setTimeout(()=>{ if(m.textContent===t) m.textContent="";},4500); }

export function setMidiMsg(t,k){ const m=$("midiMsg"); m.textContent=t; m.className="msg "+(k||""); }
export function setMidiStatus(t,on){ const s=$("midiStatus"); s.textContent=t; s.className="midi-status"+(on?" on":""); }

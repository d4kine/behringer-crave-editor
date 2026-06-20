"use strict";
import {
  state, clamp,
  CRAVE_HEADER, MIDI_HDR, OP_PATTERN, REST_FLAG, REST_NOTE,
  WIRE_ACCENT, WIRE_GLIDE, PTOP, PBOT,
} from "./state.js";

// ---- compute per-step pattern from notes ----
export function computeSteps(){
  const length = state.length;
  const steps=[]; let lastNote=48;
  for(let i=0;i<length;i++) steps.push({on:false,note:lastNote,gate:4,ratchet:1,glide:false,accent:false});
  const sorted=[...state.notes].sort((a,b)=>a.start-b.start);
  for(const n of sorted){
    const L=Math.min(n.len,length-n.start);
    for(let j=0;j<L;j++){
      const st=n.start+j; if(st>=length) break;
      const o=steps[st]; o.on=true; o.note=n.pitch; lastNote=n.pitch;
      if(j===0){ o.ratchet=n.ratchet; o.glide=n.glide; o.accent=n.accent; o.gate=(L>1?8:n.gate); }
      else if(j<L-1){ o.gate=8; o.ratchet=1; o.glide=false; o.accent=false; }
      else { o.gate=n.gate; o.ratchet=1; o.glide=false; o.accent=false; }
    }
  }
  // propagate note value into rests for valid file bytes
  let lv=48; for(const s of steps){ if(s.on) lv=s.note; else s.note=lv; }
  return steps;
}

// Everything AFTER the 32-byte CRAVE_HEADER: 00 00, blocklen, swing nibbles, seqlen,
// then 8 bytes per step. Same body feeds .seq, .syx and live SysEx.
export function buildSeqBody(){
  const steps=computeSteps(), L=state.length, out=[];
  out.push(0x00,0x00);
  const bl=0x0e+(L-1)*8; out.push((bl>>8)&0xff, bl&0xff);
  const sw=clamp(state.swing-50,0,25); out.push(Math.floor(sw/0x10), sw%0x10);
  const sl=L-1; out.push(0x00, Math.floor(sl/8), 0x00, sl%8);
  for(let i=0;i<L;i++){
    const s=steps[i]; const nv=clamp(s.note,0,127);
    out.push(Math.floor(nv/0x10), nv%0x10);
    out.push((s.gate-1)&0x07);
    out.push((s.ratchet-1)&0x03);
    out.push(0x04,0x00);
    let eff=0; if(s.glide)eff|=0x01; if(s.accent)eff|=0x04; if(!s.on)eff|=0x08;
    out.push(eff&0xff,0x00);
  }
  return out;
}

export function buildSeq(){ return new Uint8Array([...CRAVE_HEADER, ...buildSeqBody()]); }

// Inverse of buildSeqBody/computeSteps. Input = the body bytes (post CRAVE_HEADER) as an
// array/Uint8Array. Returns {length, swing, notes:[...]} reconstructed by coalescing
// the dense per-step model back into sparse note events (reversing the gate=8 tie logic).
export function decodeSeqBody(body){
  body = Array.from(body);
  if(body.length < 10) throw new Error("Body is too short.");
  const sw = body[4]*0x10 + body[5];
  const sgIn = clamp(sw+50, 50, 75);
  const seqHi = body[7], seqLo = body[9];
  let L = seqHi*8 + seqLo + 1;
  const avail = Math.floor((body.length - 10) / 8);
  if(L < 1 || L > avail) L = avail;          // tolerate truncated/odd dumps
  L = clamp(L, 1, 32);
  // dense step model
  const steps=[];
  for(let i=0;i<L;i++){
    const o = 10 + i*8;
    const pitch = body[o]*0x10 + body[o+1];
    const gate  = (body[o+2] & 0x07) + 1;
    const ratchet = (body[o+3] & 0x03) + 1;
    const eff   = body[o+6];
    steps.push({ on:!(eff & 0x08), note:pitch, gate, ratchet,
                 glide:!!(eff & 0x01), accent:!!(eff & 0x04) });
  }
  // coalesce dense steps back into sparse notes. gate=8 on a step means "tie into the next
  // step": extend the note while the current step is a tie AND the next step continues the
  // same pitch. The last step of the run carries the note's gate. (A real tie linking two
  // same-pitch notes is, by design, indistinguishable from one longer note — they sound the
  // same on hardware — so merging here is correct, not lossy.)
  const out=[]; let nid=1;
  for(let i=0;i<L;i++){
    const s=steps[i]; if(!s.on) continue;
    const pitch=s.note; let j=i;
    while(steps[j].gate===8 && j+1<L && steps[j+1].on && steps[j+1].note===pitch) j++;
    out.push({ id:nid++, start:i, len:j-i+1, pitch, gate:steps[j].gate,
               ratchet:s.ratchet, glide:s.glide, accent:s.accent });
    i=j;
  }
  return { length:L, swing:sgIn, notes:out };
}

// Build the exact 273-byte Crave pattern SysEx (opcode 0x78). Verified byte-for-byte against
// real captures in sysex/*.syx. Always emits the full 32 step records; steps past the pattern
// length (and any empty step) are encoded as rests (note 48, byte7 = 0x0f).
export function buildCraveSysex(bank,pattern){
  const steps=computeSteps(), out=[...MIDI_HDR, OP_PATTERN, bank&0x7f, pattern&0x7f];
  const sw=clamp(state.swing-50,0,25); out.push(Math.floor(sw/0x10), sw%0x10);   // swing (×2)  [encoding provisional]
  const sl=state.length-1; out.push(0x00, Math.floor(sl/8), 0x00, sl%8);         // seqlen: 00 HI 00 LO
  for(let i=0;i<32;i++){
    const s=(i<state.length)?steps[i]:null;
    if(s && s.on){
      const nv=clamp(s.note,0,127);
      let eff=0; if(s.accent)eff|=WIRE_ACCENT; if(s.glide)eff|=WIRE_GLIDE;
      out.push(Math.floor(nv/0x10), nv%0x10, (s.gate-1)&0x07, (s.ratchet-1)&0x03, 0x04,0x00, eff&0x7f, 0x00);
    } else {
      out.push(Math.floor(REST_NOTE/0x10), REST_NOTE%0x10, 0x03, 0x00, 0x04,0x00, 0x00, REST_FLAG);
    }
  }
  out.push(0xF7);
  return out;
}

// Inverse: parse a 0x78 pattern message into {bank,pattern,length,swing,notes}.
export function decodeCraveSysex(bytes){
  const b=Array.from(bytes);
  if(!MIDI_HDR.every((x,i)=>b[i]===x)) throw new Error("Not a Crave SysEx message (header).");
  if(b[7]!==OP_PATTERN) throw new Error("Not a pattern dump (opcode 0x"+(b[7]||0).toString(16)+", expected 78).");
  const bank=b[8], pattern=b[9];
  const sg=clamp(50 + (b[10]*0x10 + b[11]), 50, 75);
  const L=clamp(b[13]*8 + b[15] + 1, 1, 32);
  const steps=[];
  for(let i=0;i<L;i++){ const o=16+i*8;
    const rest=b[o+7]!==0x00;
    steps.push({ on:!rest, note:b[o]*0x10+b[o+1], gate:(b[o+2]&0x07)+1, ratchet:(b[o+3]&0x03)+1,
                 glide:!!(b[o+6]&WIRE_GLIDE), accent:!!(b[o+6]&WIRE_ACCENT) });
  }
  const out=[]; let nid=1;                                  // coalesce tied steps (same logic as decodeSeqBody)
  for(let i=0;i<L;i++){ const s=steps[i]; if(!s.on) continue;
    const pitch=s.note; let j=i;
    while(steps[j].gate===8 && j+1<L && steps[j+1].on && steps[j+1].note===pitch) j++;
    out.push({ id:nid++, start:i, len:j-i+1, pitch:clamp(pitch,PBOT,PTOP), gate:steps[j].gate,
               ratchet:s.ratchet, glide:s.glide, accent:s.accent });
    i=j;
  }
  return { bank, pattern, length:L, swing:sg, notes:out };
}

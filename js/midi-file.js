"use strict";
import { state, $, clamp, setMsg, PTOP, PBOT } from "./state.js";
import { renderAll } from "./grid.js";
import { pushUndo } from "./history.js";

function readVLQ(dv,p){let v=0,b;do{b=dv.getUint8(p++);v=(v<<7)|(b&0x7f);}while(b&0x80);return[v,p];}

function parseMidi(buf){
  const dv=new DataView(buf);
  if(dv.getUint32(0)!==0x4d546864) throw new Error("Not a valid MIDI file.");
  const division=dv.getUint16(12); if(division&0x8000) throw new Error("SMPTE is not supported.");
  const nt=dv.getUint16(10); let pos=14; const out=[];
  for(let t=0;t<nt && pos<dv.byteLength;t++){
    if(dv.getUint32(pos)!==0x4d54726b) break;
    const len=dv.getUint32(pos+4); pos+=8; const end=pos+len; let abs=0,run=0; const on={};
    while(pos<end){
      let d;[d,pos]=readVLQ(dv,pos); abs+=d;
      let st=dv.getUint8(pos); if(st&0x80){run=st;pos++;}else st=run;
      const ty=st&0xf0;
      if(st===0xff){const m=dv.getUint8(pos++);let l;[l,pos]=readVLQ(dv,pos);pos+=l;}
      else if(st===0xf0||st===0xf7){let l;[l,pos]=readVLQ(dv,pos);pos+=l;}
      else if(ty===0x90){const n=dv.getUint8(pos++),v=dv.getUint8(pos++); if(v>0)on[n]=abs; else{if(on[n]!=null){out.push({tick:on[n],note:n,dur:abs-on[n]});delete on[n];}}}
      else if(ty===0x80){const n=dv.getUint8(pos++);pos++; if(on[n]!=null){out.push({tick:on[n],note:n,dur:abs-on[n]});delete on[n];}}
      else if(ty===0xc0||ty===0xd0)pos+=1; else pos+=2;
    }
    pos=end;
  }
  return {division,out};
}

// Place the parsed notes into the pattern, keeping only the [offset, offset+win) step window
// (the window start maps to step 0). One undo entry per import.
function applyMidiImport(out, division, offset, win){
  pushUndo();
  out.sort((a,b)=>a.tick-b.tick);
  state.notes=[]; state.uid=1; let kept=0,dropped=0;
  const stepTicks=division/4;
  for(const e of out){
    const start=Math.round(e.tick/stepTicks)-offset;   // shift window start -> step 0
    if(start<0 || start>=win){ dropped++; continue; }
    const len=clamp(Math.round(e.dur/stepTicks)||1,1,win-start);
    const pitch=clamp(e.note,PBOT,PTOP);
    state.notes.push({id:state.uid++,start,len,pitch,gate:4,ratchet:1,glide:false,accent:false});
    kept++;
  }
  // enforce mono sequentially
  state.notes.sort((a,b)=>a.start-b.start);
  const merged=[];
  for(const n of state.notes){ if(merged.length && merged[merged.length-1].start===n.start) merged[merged.length-1]=n; else merged.push(n); }
  for(let i=0;i<merged.length;i++){ const mx=(i+1<merged.length)?merged[i+1].start:Infinity; merged[i].len=Math.max(1,Math.min(merged[i].len,mx-merged[i].start)); }
  state.notes=merged;
  state.length=clamp(win,1,32); $("len").value=state.length; $("lenVal").textContent=state.length;
  state.selIds=[]; renderAll(); $("scrollX").scrollLeft=0;
  let m="Imported: "+kept+" notes → "+state.length+" steps (16th-note grid, mono).";
  if(dropped) m+=" "+dropped+" note(s) outside the chosen range discarded.";
  setMsg(m,dropped?"warn":"ok");
}

// Bar.beat readout from a 0-based step (16 steps/bar, 4 steps/beat - matches grid.js buildRuler).
function stepLabel(s){ return "Bar "+(Math.floor(s/16)+1)+"."+(Math.floor((s%16)/4)+1)+" (step "+s+")"; }

// Visual mini-timeline: slide/resize a window (max 32 steps) over the whole file, then import it.
function openRangePicker(out, division, totalSteps){
  const stepTicks=division/4;
  const notes=out.map(e=>({step:Math.round(e.tick/stepTicks),dur:Math.max(1,Math.round(e.dur/stepTicks)||1),note:e.note}));
  let minP=Infinity,maxP=-Infinity;
  for(const n of notes){ if(n.note<minP)minP=n.note; if(n.note>maxP)maxP=n.note; }
  const pSpan=Math.max(1,maxP-minP);

  const overlay=$("midiRangeModal"), tl=$("mrTimeline"), win=$("mrWindow"), rz=$("mrRz");
  // render note blocks + bar/beat gridlines (rebuilt fresh each open)
  tl.querySelectorAll(".mr-note,.mr-bar").forEach(el=>el.remove());
  const H=96, pad=8, noteH=H-2*pad;
  const pct=s=>(s/totalSteps)*100;
  for(let s=0;s<=totalSteps;s+=4){
    const bar=s%16===0;
    const g=document.createElement("div"); g.className="mr-bar"+(bar?" bar":"");
    g.style.left=pct(s)+"%";
    if(bar && s<totalSteps){ const lab=document.createElement("span"); lab.textContent=String(s/16+1); g.appendChild(lab); }
    tl.appendChild(g);
  }
  for(const n of notes){
    const d=document.createElement("div"); d.className="mr-note";
    d.style.left=pct(n.step)+"%";
    d.style.width="max(2px,"+pct(n.dur)+"%)";
    d.style.top=(pad + (1-(n.note-minP)/pSpan)*noteH)+"px";
    tl.appendChild(d);
  }

  let offset=0, winLen=Math.min(32,totalSteps);
  const sync=()=>{
    offset=clamp(offset,0,totalSteps-winLen); winLen=clamp(winLen,1,Math.min(32,totalSteps-offset));
    win.style.left=pct(offset)+"%"; win.style.width=pct(winLen)+"%";
    $("mrStart").textContent="Start: "+stepLabel(offset);
    $("mrLen").textContent="Length: "+winLen+" step"+(winLen===1?"":"s");
  };
  $("mrInfo").textContent="File: "+totalSteps+" steps ("+Math.ceil(totalSteps/16)+" bars), "+out.length+" notes. Choose up to 32 steps to import.";
  sync();
  overlay.classList.add("open"); overlay.setAttribute("aria-hidden","false");

  // --- drag (move) and resize (right edge) on the step grid ---
  const stepFromClientX=cx=>{ const r=tl.getBoundingClientRect(); return Math.round(((cx-r.left)/r.width)*totalSteps); };
  let drag=null;  // {mode:'move'|'size', grabStep, startOffset, startLen}
  const onMove=ev=>{
    if(!drag) return; ev.preventDefault();
    const s=stepFromClientX(ev.clientX);
    if(drag.mode==="move"){ offset=drag.startOffset+(s-drag.grabStep); }
    else{ winLen=s-offset; }
    sync();
  };
  const onUp=()=>{ drag=null; window.removeEventListener("pointermove",onMove); window.removeEventListener("pointerup",onUp); };
  const startDrag=(ev,mode)=>{ ev.preventDefault(); ev.stopPropagation();
    drag={mode,grabStep:stepFromClientX(ev.clientX),startOffset:offset,startLen:winLen};
    window.addEventListener("pointermove",onMove); window.addEventListener("pointerup",onUp); };
  win.onpointerdown=ev=>startDrag(ev,"move");
  rz.onpointerdown=ev=>startDrag(ev,"size");

  // --- close / confirm (handlers replaced each open, so no accumulation) ---
  const close=()=>{ overlay.classList.remove("open"); overlay.setAttribute("aria-hidden","true");
    onUp(); document.removeEventListener("keydown",onKey); };
  const onKey=e=>{ if(e.key==="Escape") close(); };
  document.addEventListener("keydown",onKey);
  overlay.onpointerdown=e=>{ if(e.target===overlay) close(); };
  $("mrCancel").onclick=close;
  $("mrImport").onclick=()=>{ applyMidiImport(out,division,offset,winLen); close(); };
}

export function importMidi(file){
  const r=new FileReader();
  r.onload=()=>{ try{
    const {division,out}=parseMidi(r.result);
    if(!out.length){ setMsg("No notes found.","warn"); return; }
    const stepTicks=division/4;
    const totalSteps=Math.max(...out.map(e=>Math.round(e.tick/stepTicks)))+1;
    if(totalSteps<=32) applyMidiImport(out,division,0,totalSteps);
    else openRangePicker(out,division,totalSteps);
  }catch(err){ setMsg("Error: "+err.message,"err"); } };
  r.onerror=()=>setMsg("File is not readable.","err");
  r.readAsArrayBuffer(file);
}

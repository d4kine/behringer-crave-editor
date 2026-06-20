"use strict";
import { state, $, clamp, setMsg, fnameSafe, download, PTOP, PBOT, SCALES, noteName } from "./state.js";
import { buildSeq } from "./protocol.js";
import { buildKeysAndRows, renderAll, setVars, buildRuler, renderNotes, renderAccent,
         syncInputs, initGrid, applyZoom, rebuild } from "./grid.js";
import { snapshot, pushUndo, undo, redo, copyNote, cutNote, pasteNote,
         deleteSelected, nudge } from "./history.js";
import { importMidi } from "./midi-file.js";
import { initMidiPanel } from "./webmidi.js";

// ---- seed demo pattern ----
state.notes.push({id:state.uid++,start:0,len:1,pitch:60,gate:4,ratchet:1,glide:false,accent:false});
state.notes.push({id:state.uid++,start:4,len:1,pitch:63,gate:4,ratchet:1,glide:false,accent:false});
state.notes.push({id:state.uid++,start:8,len:2,pitch:55,gate:4,ratchet:1,glide:false,accent:true});
state.notes.push({id:state.uid++,start:12,len:1,pitch:60,gate:4,ratchet:1,glide:false,accent:false});

// ---- project save / load (JSON) ----
function saveProject(){
  const obj={app:"crave-seq", v:1, length:state.length, swing:state.swing, notes:state.notes.map(n=>({...n}))};
  download(new TextEncoder().encode(JSON.stringify(obj,null,2)), fnameSafe()+".json");
  setMsg("Project saved: "+fnameSafe()+".json","ok");
}
function loadProject(file){
  const r=new FileReader();
  r.onload=()=>{ try{
    const obj=JSON.parse(r.result);
    if(obj.app!=="crave-seq" || !Array.isArray(obj.notes)) throw new Error("Not a crave-seq project.");
    pushUndo();
    state.length=clamp(obj.length|0,1,32); state.swing=clamp(obj.swing|0,50,75);
    state.uid=1; state.notes=obj.notes.map(n=>({
      id:state.uid++, start:clamp(n.start|0,0,31), len:Math.max(1,n.len|0),
      pitch:clamp(n.pitch|0,PBOT,PTOP), gate:clamp(n.gate|0,1,8)||4,
      ratchet:clamp(n.ratchet|0,1,4)||1, glide:!!n.glide, accent:!!n.accent }));
    state.selIds=[]; syncInputs(); renderAll(); $("scrollX").scrollLeft=0;
    setMsg("Project loaded: "+state.notes.length+" notes, "+state.length+" steps.","ok");
  }catch(err){ setMsg("Error: "+err.message,"err"); } };
  r.onerror=()=>setMsg("File is not readable.","err");
  r.readAsText(file);
}

// ---- .seq export ----
$("exportBtn").onclick=()=>{
  let fn=($("fname").value||"crave-pattern").trim().replace(/[^\w\-]+/g,"_")||"crave-pattern";
  download(buildSeq(), fn+".seq");
  setMsg("Exported: "+fn+".seq ("+state.length+" steps, swing "+state.swing+"%). → SynthTribe Import + Store.","ok");
};

// ---- globals ----
// sliders: capture state on focus, commit one undo entry per adjust-session on change
let rangeSnap=null;
const armRange=()=>{ rangeSnap=snapshot(); };
const commitRange=()=>{ if(rangeSnap) pushUndo(rangeSnap); rangeSnap=snapshot(); };
$("len").addEventListener("focus", armRange);
$("swing").addEventListener("focus", armRange);
$("len").oninput=e=>{ state.length=+e.target.value; $("lenVal").textContent=state.length; setVars(); buildRuler(); renderNotes(); renderAccent(); };
$("len").onchange=commitRange;
$("swing").oninput=e=>{ state.swing=+e.target.value; $("swingVal").textContent=state.swing+"%"; };
$("swing").onchange=commitRange;
$("midiFile").onchange=e=>{ if(e.target.files[0]) importMidi(e.target.files[0]); e.target.value=""; };
$("saveBtn").onclick=saveProject;
$("projFile").onchange=e=>{ if(e.target.files[0]) loadProject(e.target.files[0]); e.target.value=""; };
$("randBtn").onclick=()=>{
  pushUndo();
  // Random generation uses the selected random root (note+octave) and scale (chromatic -> minor default).
  const scale = (state.scaleType!=="chromatic" && SCALES[state.scaleType]) ? SCALES[state.scaleType].set : [0,2,3,5,7,8,10];
  const root = clamp(state.randRoot, PBOT, PTOP-12);
  state.notes=[]; state.uid=1;
  let s=0;
  while(s<state.length){
    if(Math.random()<0.62){
      const len = Math.random()<0.2 ? 2 : 1;
      state.notes.push({id:state.uid++,start:s,len:Math.min(len,state.length-s),
        pitch:clamp(root+scale[Math.floor(Math.random()*scale.length)]+12*Math.floor(Math.random()*2),PBOT,PTOP),
        gate:2+Math.floor(Math.random()*5),
        ratchet:Math.random()<0.15?(Math.random()<0.6?2:3):1,
        glide:Math.random()<0.15, accent:Math.random()<0.25});
      s += len;
    } else s += 1;
  }
  state.selIds=[]; renderAll();
};
$("clearBtn").onclick=()=>{ pushUndo(); state.notes=[]; state.selIds=[]; renderAll(); };

// ---- tool mode (select / edit) ----
function setMode(m){
  state.mode = m;
  $("modeSelect").classList.toggle("sel", m==="select");
  $("modeEdit").classList.toggle("sel", m==="edit");
  $("grid").style.cursor = m==="edit" ? "crosshair" : "default";
}
$("modeSelect").onclick = ()=>setMode("select");
$("modeEdit").onclick   = ()=>setMode("edit");

// ---- zoom + scale toolbar ----
function syncZoom(){ $("zoomVal").textContent = Math.round(state.zoom*100)+"%"; }
$("zoomIn").onclick   = ()=>{ applyZoom(state.zoom*1.25); syncZoom(); };
$("zoomOut").onclick  = ()=>{ applyZoom(state.zoom/1.25); syncZoom(); };
$("zoomReset").onclick= ()=>{ applyZoom(1); syncZoom(); };
// populate scale dropdown from SCALES
for(const [key,sc] of Object.entries(SCALES)){
  const o=document.createElement("option"); o.value=key; o.textContent=sc.label; $("scaleType").appendChild(o);
}
$("scaleRoot").value = state.scaleRoot;
$("scaleType").value = state.scaleType;
$("scaleRoot").onchange = e=>{ state.scaleRoot=+e.target.value; rebuild(); };
$("scaleType").onchange = e=>{ state.scaleType=e.target.value; rebuild(); };

// ---- random root (note + octave) ----
for(let p=PTOP; p>=PBOT; p--){ $("randRoot").add(new Option(noteName(p), p)); }
$("randRoot").value = state.randRoot;
$("randRoot").onchange = e=>{ state.randRoot=clamp(+e.target.value, PBOT, PTOP); };

// ---- keyboard shortcuts ----
document.addEventListener("keydown", e=>{
  const t=e.target;
  if(t && (t.tagName==="INPUT" || t.tagName==="TEXTAREA" || t.isContentEditable)) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if(mod && k==="z"){ e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if(mod && k==="y"){ e.preventDefault(); redo(); return; }
  if(mod && k==="c"){ if(state.selIds.length){ e.preventDefault(); copyNote(); } return; }
  if(mod && k==="x"){ if(state.selIds.length){ e.preventDefault(); cutNote(); } return; }
  if(mod && k==="v"){ if(state.clipboard){ e.preventDefault(); pasteNote(); } return; }
  if(mod && k==="s"){ e.preventDefault(); saveProject(); return; }
  if(!mod && k==="b"){ e.preventDefault(); setMode(state.mode==="select"?"edit":"select"); return; }
  if(e.key==="Delete" || e.key==="Backspace"){ if(state.selIds.length){ e.preventDefault(); deleteSelected(); } return; }
  if(!state.selIds.length) return;
  if(e.key==="ArrowUp"){ e.preventDefault(); nudge(1,0); }
  else if(e.key==="ArrowDown"){ e.preventDefault(); nudge(-1,0); }
  else if(e.key==="ArrowLeft"){ e.preventDefault(); nudge(0,-1); }
  else if(e.key==="ArrowRight"){ e.preventDefault(); nudge(0,1); }
});

// ---- init ----
initGrid();
initMidiPanel();
buildKeysAndRows();
renderAll();
syncZoom();
setMode("select");

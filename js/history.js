"use strict";
import { state, UNDO_MAX, clamp, byId, setMsg, $, PTOP, PBOT,
         selNotes, selPrimary, selectSet, inScale } from "./state.js";
import { renderAll, syncInputs, resolveOverlaps } from "./grid.js";

// ---- undo / redo ----
export function snapshot(){ return {length:state.length, swing:state.swing, selIds:state.selIds.slice(), notes: state.notes.map(n=>({...n}))}; }
export function pushUndo(s){ state.undoStack.push(s||snapshot()); if(state.undoStack.length>UNDO_MAX) state.undoStack.shift(); state.redoStack.length=0; }
export function restore(s){
  state.length=s.length; state.swing=s.swing; state.selIds=(s.selIds||[]).slice();
  state.notes=s.notes.map(n=>({...n}));
  state.uid=Math.max(state.uid, ...state.notes.map(n=>n.id+1), 1);
  syncInputs(); renderAll();
}
export function undo(){ if(!state.undoStack.length){ setMsg("Nothing to undo.","warn"); return; } state.redoStack.push(snapshot()); restore(state.undoStack.pop()); setMsg("Undone.","ok"); }
export function redo(){ if(!state.redoStack.length){ setMsg("Nothing to redo.","warn"); return; } state.undoStack.push(snapshot()); restore(state.redoStack.pop()); setMsg("Redone.","ok"); }

// ---- clipboard (group) ----
export function copyNote(){
  const sel=selNotes(); if(!sel.length) return;
  state.clipboard={notes:sel.map(n=>({...n})), anchor:Math.min(...sel.map(n=>n.start))};
  setMsg(sel.length>1 ? sel.length+" notes copied." : "Note copied.","ok");
}
export function cutNote(){
  const sel=selNotes(); if(!sel.length) return; pushUndo();
  state.clipboard={notes:sel.map(n=>({...n})), anchor:Math.min(...sel.map(n=>n.start))};
  const ids=new Set(state.selIds); state.notes=state.notes.filter(x=>!ids.has(x.id)); state.selIds=[];
  renderAll(); setMsg(sel.length>1 ? sel.length+" notes cut." : "Note cut.","ok");
}
export function pasteNote(){
  if(!state.clipboard || !state.clipboard.notes.length) return;
  pushUndo();
  const clip=state.clipboard;
  const prim=selPrimary();
  const base=clamp(prim ? prim.start+prim.len : clip.anchor, 0, state.length-1);
  const shift=base-clip.anchor;
  const newIds=[];
  for(const c of clip.notes){
    const n={...c, id:state.uid++, start:clamp(c.start+shift,0,state.length-1)};
    n.len=clamp(n.len,1,state.length-n.start);
    state.notes.push(n); newIds.push(n.id);
  }
  newIds.map(byId).sort((a,b)=>a.start-b.start).forEach(n=>resolveOverlaps(n.id));
  selectSet(newIds); renderAll();
  setMsg((newIds.length>1 ? newIds.length+" notes pasted from step " : "Pasted at step ")+(base+1)+".","ok");
}

// ---- delete / nudge selected (group) ----
export function deleteSelected(){
  if(!state.selIds.length) return; pushUndo();
  const ids=new Set(state.selIds); state.notes=state.notes.filter(x=>!ids.has(x.id)); state.selIds=[]; renderAll();
}
// next pitch in the active scale in the given direction (used by arrow nudge)
function nextInScale(pitch, dir){
  if(!dir) return pitch;
  let p=pitch+dir;
  while(p>=PBOT && p<=PTOP){ if(inScale(p)) return p; p+=dir; }
  return pitch;
}
export function nudge(dPitch,dStart){
  const sel=selNotes(); if(!sel.length) return; pushUndo();
  if(dStart){ const mn=Math.min(...sel.map(n=>n.start)), mx=Math.max(...sel.map(n=>n.start));
    dStart=clamp(dStart,-mn,(state.length-1)-mx); sel.forEach(n=>n.start+=dStart); }
  if(dPitch){
    if(state.scaleType==="chromatic"){
      const mn=Math.min(...sel.map(n=>n.pitch)), mx=Math.max(...sel.map(n=>n.pitch));
      dPitch=clamp(dPitch,PBOT-mn,PTOP-mx); sel.forEach(n=>n.pitch+=dPitch);
    } else {                                   // diatonic step: each note jumps to the next scale degree
      const dir=Math.sign(dPitch); sel.forEach(n=>n.pitch=nextInScale(n.pitch,dir));
    }
  }
  sel.slice().sort((a,b)=>a.start-b.start).forEach(n=>resolveOverlaps(n.id));
  renderAll();
}

// apply a decoded {length,swing,notes} result (from .seq/.syx import or live read)
export function applyDecoded(res){
  pushUndo();
  state.length=clamp(res.length,1,32); state.swing=clamp(res.swing,50,75);
  state.uid=1; state.notes=res.notes.map(n=>({...n, id:state.uid++}));
  state.selIds=[]; syncInputs(); renderAll(); $("scrollX").scrollLeft=0;
}

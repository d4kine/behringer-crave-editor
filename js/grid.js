"use strict";
import { state, $, clamp, byId, noteName, isBlack,
         CW, CH, PTOP, PBOT, ROWS, setZoom, inScale, snapPitch,
         isSel, selNotes, selectOnly, selectSet, selectToggle } from "./state.js";
import { pushUndo, snapshot } from "./history.js";

// ---- CSS variables + element sizing ----
export function setVars(){
  const root = document.documentElement.style;
  root.setProperty("--cw", CW+"px");
  root.setProperty("--ch", CH+"px");
  root.setProperty("--gridH", (ROWS*CH)+"px");
  root.setProperty("--barW", (16*CW)+"px");
  root.setProperty("--beatW", (4*CW)+"px");
  $("grid").style.width = (state.length*CW)+"px";
  $("ruler").style.width = (state.length*CW)+"px";
  $("accent").style.width = (state.length*CW)+"px";
  $("keys").style.height = (ROWS*CH)+"px";
}

export function buildKeysAndRows(){
  const keys = $("keys"), rows = $("rows"); keys.innerHTML=""; rows.innerHTML="";
  for(let r=0;r<ROWS;r++){
    const pitch = PTOP - r;
    const off = !inScale(pitch);                 // dim rows outside the active scale
    const isRoot = ((pitch - state.scaleRoot)%12+12)%12 === 0;
    const k = document.createElement("div");
    k.className = "key" + (isBlack(pitch)?" black":"") + (pitch%12===0?" c":"") + (off?" offscale":"") + (isRoot?" root":"");
    k.style.top = (r*CH)+"px";
    if(pitch%12===0) k.textContent = noteName(pitch);
    keys.appendChild(k);
    const row = document.createElement("div");
    row.className = "row" + (isBlack(pitch)?" black":"") + (off?" offscale":"") + (isRoot?" root":"");
    row.style.top = (r*CH)+"px";
    rows.appendChild(row);
  }
}

export function buildRuler(){
  const ru = $("ruler"); ru.innerHTML="";
  for(let s=0;s<state.length;s+=4){
    const bar = Math.floor(s/16)+1, beat = Math.floor((s%16)/4)+1;
    const d = document.createElement("div");
    d.className = "bk" + (beat===1?" bar":"");
    d.style.left = (s*CW)+"px";
    d.textContent = beat===1 ? bar : bar+"."+beat;
    ru.appendChild(d);
  }
}

export function renderNotes(){
  const layer = $("notes"); layer.innerHTML="";
  for(const n of state.notes){
    if(n.start>=state.length) continue;
    const len = Math.min(n.len, state.length-n.start);
    const el = document.createElement("div");
    el.className = "note" + (n.accent?" accent":"") + (isSel(n.id)?" sel":"");
    el.style.left = (n.start*CW)+"px";
    el.style.top  = ((PTOP-n.pitch)*CH + 1)+"px";
    el.style.width = (len*CW-2)+"px";
    el.dataset.id = n.id;
    const name = document.createElement("span"); name.className="nname"; name.textContent = noteName(n.pitch);
    el.appendChild(name);
    // per-note attribute badges (glide / ratchet / accent) visible at a glance
    const badges = document.createElement("span"); badges.className="badges";
    if(n.glide){ const b=document.createElement("span"); b.className="badge gl"; b.textContent="G"; b.title="Glide"; badges.appendChild(b); }
    if(n.ratchet>1){ const b=document.createElement("span"); b.className="badge rt"; b.textContent="×"+n.ratchet; b.title="Ratchet ×"+n.ratchet; badges.appendChild(b); }
    if(n.accent){ const b=document.createElement("span"); b.className="badge ac"; b.textContent="A"; b.title="Accent"; badges.appendChild(b); }
    if(badges.childNodes.length) el.appendChild(badges);
    const rz = document.createElement("div"); rz.className="rz"; el.appendChild(rz);
    layer.appendChild(el);
  }
}

export function renderAccent(){
  const a = $("accent");
  [...a.querySelectorAll(".stem")].forEach(e=>e.remove());
  const H = 50;
  for(const n of state.notes){
    if(n.start>=state.length) continue;
    const s = document.createElement("div");
    s.className = "stem" + (n.accent?" on":"");
    s.style.left = (n.start*CW + CW/2 - 1)+"px";
    s.style.height = (n.accent? H : H*0.5)+"px";
    const dot = document.createElement("div"); dot.className="dot"; s.appendChild(dot);
    s.dataset.id = n.id;
    s.onclick = () => { const note = byId(+s.dataset.id); if(note){ pushUndo(); note.accent=!note.accent; renderNotes(); renderAccent(); if(isSel(note.id)) renderInspector(); } };
    a.appendChild(s);
  }
}

// shared value across a set of notes, or null if they differ
function commonVal(notes, key){ const v=notes[0][key]; return notes.every(n=>n[key]===v) ? v : null; }

export function renderInspector(){
  const ins = $("inspector");
  const sel = selNotes();
  if(!sel.length){ ins.className="inspector empty"; ins.textContent="No note selected - select a note (Select) or draw in Edit mode (B key)."; return; }
  ins.className="inspector"; ins.innerHTML="";

  const multi = sel.length>1;
  // editing helper: mutate every selected note, one undo entry per action
  const apply = (fn, full)=>{ pushUndo(); sel.forEach(fn); if(full){ renderNotes(); renderAccent(); } renderInspector(); };

  const info = document.createElement("span");
  if(multi){
    const lo=Math.min(...sel.map(n=>n.start))+1, hi=Math.max(...sel.map(n=>n.start))+1;
    info.innerHTML = '<span class="insp-lab">'+sel.length+' Notes</span> · Steps '+lo+'–'+hi;
  } else {
    const n=sel[0];
    info.innerHTML = '<span class="insp-lab">'+noteName(n.pitch)+'</span> · Step '+(n.start+1)+' · Length '+n.len;
  }
  ins.appendChild(info);

  const gateVal = commonVal(sel,"gate");
  const gl = document.createElement("span"); gl.className="legend"; gl.style.fontSize="11px";
  gl.textContent = (!multi && sel[0].len>1) ? "Gate (last step)" : "Gate";
  const gseg = document.createElement("span"); gseg.className="seg";
  for(let g=1;g<=8;g++){ const b=document.createElement("button"); b.textContent = g===8?"T":g; if(g===gateVal)b.classList.add("sel");
    b.onclick=()=>apply(n=>n.gate=g); gseg.appendChild(b); }

  const ratVal = commonVal(sel,"ratchet");
  const rl = document.createElement("span"); rl.className="legend"; rl.style.fontSize="11px"; rl.textContent="Ratchet";
  const rseg = document.createElement("span"); rseg.className="seg";
  [1,2,3,4].forEach(rv=>{ const b=document.createElement("button"); b.textContent="×"+rv; if(rv===ratVal)b.classList.add("sel");
    b.onclick=()=>apply(n=>n.ratchet=rv); rseg.appendChild(b); });

  // toggles: "on" only when every selected note has it; click turns all on unless all already on
  const allGlide = sel.every(n=>n.glide), allAccent = sel.every(n=>n.accent);
  const glide=document.createElement("button"); glide.className="tg"+(allGlide?" on":""); glide.textContent="Glide";
  glide.onclick=()=>apply(n=>n.glide=!allGlide);
  const acc=document.createElement("button"); acc.className="tg"+(allAccent?" on":""); acc.textContent="Accent";
  acc.onclick=()=>apply(n=>n.accent=!allAccent, true);
  const del=document.createElement("button"); del.className="tg"; del.style.borderColor="var(--led)"; del.style.color="var(--led-glow)";
  del.textContent = multi ? "Delete ("+sel.length+")" : "Delete";
  del.onclick=()=>{ pushUndo(); const ids=new Set(state.selIds); state.notes=state.notes.filter(x=>!ids.has(x.id)); state.selIds=[]; renderAll(); };

  ins.append(gl,gseg,rl,rseg,glide,acc,del);
}

export function renderAll(){ setVars(); buildRuler(); renderNotes(); renderAccent(); renderInspector(); }

// full rebuild incl. keys/rows (their geometry/scale classes change with zoom or scale)
export function rebuild(){ buildKeysAndRows(); renderAll(); }
export function applyZoom(z){ setZoom(z); rebuild(); }

// sync the two range inputs + their labels to current state
export function syncInputs(){
  $("len").value=state.length; $("lenVal").textContent=state.length;
  $("swing").value=state.swing; $("swingVal").textContent=state.swing+"%";
}

// ---- overlap resolution (mono) after an interactive edit ----
export function resolveOverlaps(activeId){
  const a = byId(activeId); if(!a) return;
  a.start = clamp(a.start,0,state.length-1);
  a.len = clamp(a.len,1,state.length-a.start);
  a.pitch = clamp(a.pitch,PBOT,PTOP);
  // delete notes that START within A's range
  state.notes = state.notes.filter(n => n.id===activeId || !(n.start>=a.start && n.start<a.start+a.len));
  // trim a note that CONTAINS A's start
  for(const n of state.notes){ if(n.id!==activeId && n.start<a.start && n.start+n.len>a.start) n.len = a.start-n.start; }
  // clamp A so it doesn't run into the next note
  const nexts = state.notes.filter(n=>n.id!==activeId && n.start>a.start).sort((x,y)=>x.start-y.start);
  if(nexts.length) a.len = Math.min(a.len, nexts[0].start - a.start);
  a.len = Math.max(1,a.len);
}

// ---- pointer interaction ----
let drag = null;

export function initGrid(){
  const grid = $("grid");
  const marquee = $("marquee");

  // edit-mode "paint": drop a 1-step note on each freshly-entered empty step
  function paintAt(step, pitch){
    if(step===drag.lastStep) return;                 // only act on step changes
    drag.lastStep = step;
    if(state.notes.some(n=>n.start===step)) return;  // never overwrite an existing step
    const n = {id:state.uid++, start:step, len:1, pitch:snapPitch(pitch), gate:4, ratchet:1, glide:false, accent:false};
    state.notes.push(n); resolveOverlaps(n.id); drag.painted.push(n.id); drag.created=true;
    selectSet(drag.painted); renderNotes(); renderAccent();
  }

  // edit-mode "erase": remove the note the pointer lands on (click or drag-over)
  function eraseAt(id){
    const before = state.notes.length;
    state.notes = state.notes.filter(n=>n.id!==id);
    if(state.notes.length!==before){
      state.selIds = state.selIds.filter(x=>x!==id);
      drag.erased = true; renderNotes(); renderAccent(); renderInspector();
    }
  }

  grid.addEventListener("pointerdown", e=>{
    const noteEl = e.target.closest(".note");
    const rect = grid.getBoundingClientRect();
    const gx = e.clientX-rect.left, gy = e.clientY-rect.top;
    const step = clamp(Math.floor(gx/CW),0,state.length-1);
    const pitch = clamp(PTOP - Math.floor(gy/CH), PBOT, PTOP);
    const preSnap = snapshot();   // pushed in pointerup only if the gesture changed something

    if(noteEl){
      const id = +noteEl.dataset.id;
      if(state.mode==="edit"){            // pencil mode: clicking/dragging over a note erases it
        drag = { mode:"erase", erased:false, snap:preSnap };
        eraseAt(id); grid.setPointerCapture(e.pointerId);
        return;
      }
      const resize = e.target.classList.contains("rz");
      if(e.shiftKey && !resize){          // shift+click: toggle membership, no drag
        selectToggle(id); renderNotes(); renderInspector();
        return;
      }
      if(!isSel(id)) selectOnly(id);      // clicking an unselected note selects it alone
      const n = byId(id);
      if(resize){
        drag = { mode:"resize", id, x:e.clientX, y:e.clientY, oLen:n.len, moved:false, created:false, snap:preSnap };
      } else {
        // group move: capture every selected note + group bounds so the delta clamps as a whole
        const grp = selNotes().map(g=>({id:g.id, oStart:g.start, oPitch:g.pitch, oLen:g.len}));
        drag = { mode:"move", id, x:e.clientX, y:e.clientY, grp, moved:false, created:false, snap:preSnap,
                 minStart:Math.min(...grp.map(g=>g.oStart)), maxStart:Math.max(...grp.map(g=>g.oStart)),
                 minPitch:Math.min(...grp.map(g=>g.oPitch)), maxPitch:Math.max(...grp.map(g=>g.oPitch)) };
      }
      renderNotes(); renderInspector();
    } else if(state.mode==="edit"){
      // edit mode on empty space: paint notes (one per dragged-over step)
      drag = { mode:"paint", x:e.clientX, y:e.clientY, painted:[], lastStep:-1, moved:false, created:false, snap:preSnap };
      paintAt(step, pitch);
    } else {
      // select mode on empty space: rubber-band marquee (click without drag = deselect)
      drag = { mode:"marquee", x:e.clientX, y:e.clientY, ox:gx, oy:gy, startStep:step, startPitch:pitch,
               additive:e.shiftKey, baseSel:state.selIds.slice(), moved:false, created:false, snap:preSnap };
    }
    grid.setPointerCapture(e.pointerId);
  });

  grid.addEventListener("pointermove", e=>{
    if(!drag) return;
    if(Math.abs(e.clientX-drag.x)>3 || Math.abs(e.clientY-drag.y)>3) drag.moved=true;

    if(drag.mode==="paint" || drag.mode==="erase"){
      const rect = grid.getBoundingClientRect();
      const step = clamp(Math.floor((e.clientX-rect.left)/CW),0,state.length-1);
      const pitch = clamp(PTOP - Math.floor((e.clientY-rect.top)/CH), PBOT, PTOP);
      if(drag.mode==="paint") paintAt(step, pitch);
      else { const hit = state.notes.find(n=> n.pitch===pitch && step>=n.start && step<n.start+n.len); if(hit) eraseAt(hit.id); }
      return;
    }

    if(drag.mode==="marquee"){
      const rect = grid.getBoundingClientRect();
      const cx = clamp(e.clientX-rect.left, 0, state.length*CW);
      const cy = clamp(e.clientY-rect.top, 0, ROWS*CH);
      const x0=Math.min(drag.ox,cx), y0=Math.min(drag.oy,cy), x1=Math.max(drag.ox,cx), y1=Math.max(drag.oy,cy);
      marquee.style.display="block";
      marquee.style.left=x0+"px"; marquee.style.top=y0+"px";
      marquee.style.width=(x1-x0)+"px"; marquee.style.height=(y1-y0)+"px";
      const stepMin=Math.floor(x0/CW), stepMax=Math.floor(x1/CW);
      const pitchTop=PTOP-Math.floor(y0/CH), pitchBot=PTOP-Math.floor(y1/CH);
      const hit = state.notes
        .filter(n=> n.pitch>=pitchBot && n.pitch<=pitchTop && n.start<=stepMax && n.start+n.len-1>=stepMin)
        .map(n=>n.id);
      selectSet(drag.additive ? [...drag.baseSel, ...hit] : hit);
      renderNotes(); renderInspector();
      return;
    }

    const dC = Math.round((e.clientX-drag.x)/CW);
    const dR = Math.round((e.clientY-drag.y)/CH);
    if(drag.mode==="resize"){
      const n = byId(drag.id); if(!n) return;
      n.len = clamp(drag.oLen + dC, 1, state.length - n.start);
    } else { // move the whole group; clamp delta to keep every note in bounds (spacing preserved)
      const dc = clamp(dC, -drag.minStart, (state.length-1)-drag.maxStart);
      const dr = clamp(dR, drag.maxPitch-PTOP, drag.minPitch-PBOT);
      for(const g of drag.grp){ const n=byId(g.id); if(!n) continue;
        n.start = g.oStart + dc; n.pitch = snapPitch(g.oPitch - dr); n.len = Math.min(g.oLen, state.length-n.start); }
    }
    renderNotes(); renderAccent();
  });

  grid.addEventListener("pointerup", e=>{
    if(!drag) return;
    if(drag.mode==="paint" || drag.mode==="erase"){
      if(drag.created || drag.erased) pushUndo(drag.snap);   // one undo entry for the whole stroke
      drag=null; renderNotes(); renderAccent(); renderInspector();
      return;
    }
    if(drag.mode==="marquee"){
      marquee.style.display="none";
      if(!drag.moved) selectSet([]);   // a click on empty space clears the selection
      // marquee with movement: selection already applied live, nothing to undo
    } else if(drag.created || drag.moved){
      pushUndo(drag.snap);
      if(drag.mode==="move"){
        drag.grp.map(g=>byId(g.id)).filter(Boolean).sort((a,b)=>a.start-b.start).forEach(n=>resolveOverlaps(n.id));
      } else resolveOverlaps(drag.id);
    } else if(drag.mode==="move"){
      selectOnly(drag.id);   // plain click on a note in a group collapses to just that note
    }
    drag=null;
    renderNotes(); renderAccent(); renderInspector();
  });

  grid.addEventListener("dblclick", e=>{
    const noteEl = e.target.closest(".note"); if(!noteEl) return;
    pushUndo();
    const id=+noteEl.dataset.id; state.notes=state.notes.filter(n=>n.id!==id); state.selIds=state.selIds.filter(x=>x!==id);
    renderNotes(); renderAccent(); renderInspector();
  });
  grid.addEventListener("contextmenu", e=>{
    const noteEl = e.target.closest(".note"); if(!noteEl) return; e.preventDefault();
    pushUndo();
    const id=+noteEl.dataset.id; state.notes=state.notes.filter(n=>n.id!==id); state.selIds=state.selIds.filter(x=>x!==id);
    renderNotes(); renderAccent(); renderInspector();
  });
}

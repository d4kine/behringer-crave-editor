"use strict";
import { state, $, clamp, fnameSafe, download, setMidiMsg, setMidiStatus,
         CRAVE_HEADER, MIDI_HDR, OP_PATTERN, OP_REQUEST } from "./state.js";
import { buildCraveSysex, decodeCraveSysex, decodeSeqBody } from "./protocol.js";
import { applyDecoded } from "./history.js";

let midiAccess=null, midiOut=null, midiIn=null, pendingRead=null;

function slotLabel(bank=curBank(), pattern=curPattern()){
  return "Bank "+(bank+1)+" / Pattern "+(pattern+1);
}

function updateSlotTarget(){
  const t = $("slotTarget");
  if(t) t.textContent = slotLabel();
}

function updateMidiActions(){
  const write = $("writeBtn"), read = $("readBtn");
  if(write){
    write.disabled = !midiOut;
    write.title = midiOut ? "Overwrite the selected Crave slot" : "Connect MIDI and choose an OUT port first";
  }
  if(read){
    read.disabled = !midiIn;
    read.title = midiIn ? "Load an incoming pattern dump" : "Connect MIDI and choose an IN port first";
  }
  updateSlotTarget();
}

async function connectMidi(){
  if(!navigator.requestMIDIAccess){ setMidiMsg("Web MIDI is not available - Chrome or Edge is required.","err"); return; }
  try{
    midiAccess = await navigator.requestMIDIAccess({sysex:true});
    midiAccess.onstatechange = populatePorts;
    populatePorts();
    setMidiStatus("Connected.", true);
    setMidiMsg("MIDI connected (SysEx allowed).","ok");
  }catch(err){ setMidiStatus("Access denied.", false); setMidiMsg("MIDI denied: "+err.message,"err"); }
}

function fillPortSelect(sel, ports, current){
  const keep = current && [...ports.values()].some(p=>p.id===current) ? current : "";
  sel.innerHTML = '<option value="">— not connected —</option>';
  let auto="";
  for(const p of ports.values()){
    const o=document.createElement("option"); o.value=p.id; o.textContent=p.name; sel.appendChild(o);
    if(!auto && /crave/i.test(p.name)) auto=p.id;
  }
  sel.value = keep || auto;
  return sel.value;
}
function populatePorts(){
  if(!midiAccess) return;
  selectOut(fillPortSelect($("midiOut"), midiAccess.outputs, midiOut && midiOut.id));
  selectIn(fillPortSelect($("midiIn"), midiAccess.inputs, midiIn && midiIn.id));
}
function selectOut(id){
  midiOut = (id && midiAccess) ? midiAccess.outputs.get(id) : null;
  updateMidiActions();
}
function selectIn(id){
  if(midiIn) midiIn.onmidimessage = null;
  midiIn = (id && midiAccess) ? midiAccess.inputs.get(id) : null;
  if(midiIn) midiIn.onmidimessage = onMidiMessage;
  updateMidiActions();
}
function sendBytes(arr){
  if(!midiOut){ setMidiMsg("No MIDI output selected.","warn"); return false; }
  midiOut.send(arr instanceof Uint8Array ? arr : Uint8Array.from(arr));
  return true;
}

// ---- SysEx payload / messages ----
function curBank(){ return clamp(+$("bank").value-1,0,7); }
function curPattern(){ return clamp(+$("pattern").value-1,0,7); }

function exportSyx(){
  try{
    download(Uint8Array.from(buildCraveSysex(curBank(), curPattern())), fnameSafe()+".syx");
    setMidiMsg(".syx exported: "+fnameSafe()+".syx ("+slotLabel()+").","ok");
  }catch(err){ setMidiMsg("Error: "+err.message,"err"); }
}
function writeToCrave(){
  if(!midiOut){ setMidiMsg("No MIDI output selected - connect MIDI first.","warn"); return; }
  const b=curBank(), p=curPattern();
  const target = slotLabel(b, p);
  if(!confirm("OVERWRITE "+target+" on the Crave?\n\nThe existing contents of this slot will be lost.")) return;
  try{
    if(sendBytes(buildCraveSysex(b,p))) setMidiMsg("Sent to Crave: "+target+" ("+state.length+" steps).","ok");
  }catch(err){ setMidiMsg("Error: "+err.message,"err"); }
}
function requestFromCrave(){
  if(!midiIn){ setMidiMsg("No MIDI input selected - required for the response.","warn"); return; }
  const b=curBank(), p=curPattern();
  if(pendingRead) clearTimeout(pendingRead.timer);
  pendingRead = { timer: setTimeout(()=>{ pendingRead=null;
    setMidiMsg("No response. Request opcode is still unconfirmed - alternatively press \"Dump\" in SynthTribe; incoming 78 messages load automatically.","warn"); }, 2500) };
  if(midiOut) sendBytes([...MIDI_HDR, OP_REQUEST, b&0x7f, p&0x7f, 0xF7]);   // best-effort trigger (opcode unconfirmed)
  setMidiMsg("Waiting for pattern dump from Crave ("+slotLabel(b, p)+")...","ok");
}

function onMidiMessage(ev){
  const d = ev.data;
  if(d[0]===0xF0) logSysex(d);
  // auto-load any incoming Crave pattern dump (78), whether we requested it or SynthTribe sent it
  if(d[0]===0xF0 && MIDI_HDR.every((b,i)=>d[i]===b) && d[7]===OP_PATTERN){
    try{
      const res=decodeCraveSysex(d);
      if(pendingRead){ clearTimeout(pendingRead.timer); pendingRead=null; }
      $("bank").value=res.bank+1; $("pattern").value=res.pattern+1;
      updateSlotTarget();
      applyDecoded(res);
      setMidiMsg("Pattern read: "+slotLabel(res.bank, res.pattern)+" - "+res.notes.length+" notes, "+res.length+" steps.","ok");
    }catch(err){ setMidiMsg("Pattern dump received, decoding failed: "+err.message,"warn"); }
  }
}

// ---- raw SysEx monitor ----
let logLines=[];
function logSysex(data){
  const hex=[...data].map(b=>b.toString(16).padStart(2,"0")).join(" ");
  logLines.unshift("["+data.length+"B] "+hex);
  if(logLines.length>50) logLines.length=50;
  $("sysexLog").textContent = logLines.join("\n");
  const panel = $("sysexPanel"), badge = $("logBadge");
  if(panel) panel.open = true;
  if(badge) badge.textContent = logLines.length+" message"+(logLines.length===1?"":"s");
}

// ---- file import: .syx (78 SysEx) or our .seq (CRAVE_HEADER + body) ----
function importSysexFile(file){
  const r=new FileReader();
  r.onload=()=>{ try{
    const bytes=new Uint8Array(r.result);
    let res;
    if(bytes[0]===0xF0){                                   // a .syx pattern message
      res=decodeCraveSysex(bytes);
      $("bank").value=res.bank+1; $("pattern").value=res.pattern+1;
      updateSlotTarget();
    } else if(bytes.length>=CRAVE_HEADER.length && CRAVE_HEADER.every((b,i)=>bytes[i]===b)){
      res=decodeSeqBody(Array.from(bytes.slice(CRAVE_HEADER.length)));   // our .seq file format
    } else {
      res=decodeSeqBody(Array.from(bytes));                // assume a bare .seq body
    }
    applyDecoded(res);
    setMidiMsg("Imported: "+res.notes.length+" notes, "+res.length+" steps, swing "+res.swing+"%.","ok");
  }catch(err){ setMidiMsg("Import error: "+err.message,"err"); } };
  r.onerror=()=>setMidiMsg("File is not readable.","err");
  r.readAsArrayBuffer(file);
}

// ---- MIDI panel wiring ----
export function initMidiPanel(){
  const bank=$("bank"), pat=$("pattern");
  for(let i=1;i<=8;i++){ bank.add(new Option(i,i)); pat.add(new Option(i,i)); }
  $("midiConnect").onclick=connectMidi;
  $("midiOut").onchange=e=>selectOut(e.target.value);
  $("midiIn").onchange=e=>selectIn(e.target.value);
  bank.onchange=updateSlotTarget;
  pat.onchange=updateSlotTarget;
  $("syxBtn").onclick=exportSyx;
  $("syxFile").onchange=e=>{ if(e.target.files[0]) importSysexFile(e.target.files[0]); e.target.value=""; };
  $("writeBtn").onclick=writeToCrave;
  $("readBtn").onclick=requestFromCrave;
  $("logClear").onclick=()=>{ logLines=[]; $("sysexLog").textContent="(cleared)"; const b=$("logBadge"); if(b) b.textContent="No messages"; };
  updateMidiActions();
}

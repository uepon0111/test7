import {loadImage,imageToCanvas} from './image.js';
import {detectLayout,drawOverlay} from './scanner.js';
import {createOCRManager,specs} from './ocr.js';
import {qs,setStatus,toast,drawSource,renderResults,renderCoords,renderRegions,renderScans,downloadText,downloadBlob} from './ui.js';

const state={image:null,canvas:null,layout:null,debug:null,overlay:true,ocr:null,ocrResults:null,fileName:''};

qs('imageInput').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{state.fileName=file.name;state.image=await loadImage(file);state.canvas=imageToCanvas(state.image);drawSource(state.image,state.canvas);qs('runButton').disabled=false;qs('imageInfo').textContent=`${state.canvas.width} × ${state.canvas.height} / ${Math.round(file.size/1024)} KB`;setStatus('画像を読み込みました');}catch(err){setStatus(err.message||String(err),'error')}});
qs('runButton').addEventListener('click',run);
qs('toggleOverlay').addEventListener('click',()=>{state.overlay=!state.overlay;qs('toggleOverlay').textContent=state.overlay?'オーバーレイ非表示':'オーバーレイ表示';updateOverlay()});
qs('downloadOverlay').addEventListener('click',()=>{if(!state.overlayCanvas)return;state.overlayCanvas.toBlob(blob=>blob&&downloadBlob('overlay.png',blob),'image/png')});
qs('downloadDebug').addEventListener('click',()=>{if(!state.layout)return;downloadText('debug.json',JSON.stringify(makeDebugExport(),null,2))});

async function run(){if(!state.canvas)return;setStatus('位置検出中…');qs('runButton').disabled=true;try{const detected=detectLayout(state.canvas);state.layout=detected.layout;state.debug=detected.debug;renderCoords(state.layout);renderScans(state.debug.scans);updateOverlay();qs('toggleOverlay').disabled=false;qs('downloadDebug').disabled=false;qs('downloadOverlay').disabled=false;setStatus('OCR準備中…');state.ocr=state.ocr||await createOCRManager(m=>{if(m.status==='recognizing text')setStatus(`OCR中… ${Math.round((m.progress||0)*100)}%`)});const results={};for(const k of 'ABCDEFGHI'.split('')){setStatus(`OCR: ${k} (${specs[k].label})…`);const r=state.layout.regions[k];const c=document.createElement('canvas');c.width=Math.max(1,r.x2-r.x1);c.height=Math.max(1,r.y2-r.y1);c.getContext('2d').drawImage(state.canvas,r.x1,r.y1,c.width,c.height,0,0,c.width,c.height);results[k]=await state.ocr.recognize(c,specs[k])}
  state.ocrResults=results;const out={title:results.A.cleaned,difficulty:results.B.cleaned,level:results.C.cleaned,perfect:results.D.cleaned,great:results.E.cleaned,good:results.F.cleaned,bad:results.G.cleaned,miss:results.H.cleaned,combo:results.I.cleaned};renderResults(out);renderRegions(state.canvas,state.layout.regions,results);qs('ocrRaw').textContent=JSON.stringify(Object.fromEntries(Object.entries(results).map(([k,v])=>[k,{raw:v.raw,cleaned:v.cleaned,confidence:v.confidence,invert:v.invert}])),null,2);qs('debugJson').textContent=JSON.stringify(makeDebugExport(),null,2);setStatus('完了','ok');
  }catch(err){console.error(err);setStatus(err.message||String(err),'error');toast(err.message||String(err));}finally{qs('runButton').disabled=false}}

function updateOverlay(){if(!state.canvas||!state.layout)return;state.overlayCanvas=drawOverlay(state.canvas,state.layout,state.overlay);const stage=qs('overlayCanvas');stage.width=state.overlayCanvas.width;stage.height=state.overlayCanvas.height;stage.getContext('2d').drawImage(state.overlayCanvas,0,0)}
function makeDebugExport(){return {version:1,createdAt:new Date().toISOString(),fileName:state.fileName,image:{width:state.canvas?.width,height:state.canvas?.height},layout:state.layout,debug:state.debug,ocr:state.ocrResults?Object.fromEntries(Object.entries(state.ocrResults).map(([k,v])=>[k,{raw:v.raw,cleaned:v.cleaned,confidence:v.confidence,invert:v.invert}])):null}}

window.addEventListener('beforeunload',()=>{state.ocr?.terminate?.()});

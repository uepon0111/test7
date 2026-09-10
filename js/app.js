import {detectGeometry} from "./geometry.js";
import {runOCR} from "./ocr.js";
import {cropCanvas} from "./image.js";
import {drawOverlay,geometryText,makeProfileText} from "./debug.js";

const $=s=>document.querySelector(s);
const fileInput=$("#fileInput"),runButton=$("#runButton"),rerun=$("#rerunOcrButton"),status=$("#status"),empty=$("#emptyState");
const source=$("#sourceCanvas"),overlay=$("#overlayCanvas"),debug=$("#debugOutput"),regions=$("#regions");
let currentImage=null,currentGeometry=null,currentOCR=null,debugMode="scans";

function setStatus(s){status.textContent=s}
function fitCanvas(canvas,w,h){canvas.width=w;canvas.height=h}
function showImage(img){fitCanvas(source,img.naturalWidth,img.naturalHeight);fitCanvas(overlay,img.naturalWidth,img.naturalHeight);source.getContext("2d").drawImage(img,0,0);overlay.getContext("2d").clearRect(0,0,overlay.width,overlay.height);empty.style.display="none";source.style.maxWidth="100%";overlay.style.maxWidth="100%"}
function output(o){$("#outTitle").textContent=o.title||"—";$("#outDifficulty").textContent=o.difficulty||"—";$("#outLevel").textContent=o.level||"—";$("#outPerfect").textContent=o.perfect||"—";$("#outGreat").textContent=o.great||"—";$("#outGood").textContent=o.good||"—";$("#outBad").textContent=o.bad||"—";$("#outMiss").textContent=o.miss||"—";$("#outCombo").textContent=o.combo||"—"}
function renderRegions(ocr){
  regions.innerHTML="";
  for(const k of "ABCDEFGHI"){const r=currentGeometry.regions[k],d=ocr?.results?.[k];const el=document.createElement("article");el.className="region";el.innerHTML=`<h3>領域 ${k}</h3><div class="region-meta">x=${Math.round(r.x)}, y=${Math.round(r.y)}, w=${Math.round(r.w)}, h=${Math.round(r.h)}${d?` / OCR信頼度 ${Math.round(Math.max(0,d.confidence))}`:""}</div><div class="images"><figure><figcaption>処理前</figcaption><img></figure><figure><figcaption>処理後</figcaption><img></figure></div>`;const imgs=el.querySelectorAll("img");const raw=r;const rawCanvas=cropCanvas(source,raw.x,raw.y,raw.w,raw.h);imgs[0].src=rawCanvas.toDataURL("image/png");if(d?.images?.[d.variant])imgs[1].src=d.images[d.variant].toDataURL("image/png");else imgs[1].src=imgs[0].src;regions.appendChild(el)}
}
function debugRefresh(){
  if(!currentGeometry){debug.textContent="デバッグ情報はここに表示されます。";return}
  if(debugMode==="scans")debug.textContent=geometryText(currentGeometry)+"\n\n"+makeProfileText(source,currentGeometry);
  else if(debugMode==="ocr")debug.textContent=currentOCR?JSON.stringify(currentOCR.logs,null,2):"まだOCRを実行していません。";
  else debug.textContent=makeProfileText(source,currentGeometry);
}
function setupTabs(){document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");debugMode=b.dataset.debug;debugRefresh()}))}
async function loadFile(file){
  const url=URL.createObjectURL(file);const img=new Image();img.onload=()=>{currentImage=img;showImage(img);runButton.disabled=false;rerun.disabled=true;currentGeometry=null;currentOCR=null;output({});regions.innerHTML="";setStatus(`${img.naturalWidth} × ${img.naturalHeight} / 読み取り待ち`);URL.revokeObjectURL(url)};img.onerror=()=>{setStatus("画像を読み込めませんでした");URL.revokeObjectURL(url)};img.src=url
}
async function run(){
  if(!currentImage)return;
  runButton.disabled=true;rerun.disabled=true;
  try{
    setStatus("位置を検出しています…");currentGeometry=detectGeometry(source);drawOverlay(overlay,currentGeometry);debugRefresh();renderRegions(null);
    setStatus("OCRエンジンを起動しています…");
    currentOCR=await runOCR(source,currentGeometry,m=>{if(m?.status==="recognizing")setStatus(`OCR中: 領域 ${m.region}`)});
    output(currentOCR.out);renderRegions(currentOCR);debugRefresh();
    const missing=[];for(const [k,v] of Object.entries(currentOCR.out))if(!v)missing.push(k);
    $("#ocrNotice").textContent=missing.length?`読み取り結果が空の項目があります: ${missing.join(", ")}\nデバッグのOCRログと領域画像を確認してください。`:"すべての主要項目を取得しました。";
    setStatus("読み取り完了");
    rerun.disabled=false;
  }catch(e){console.error(e);setStatus(`エラー: ${e.message||e}`);debug.textContent=(e.stack||String(e))}
  finally{runButton.disabled=false}
}
async function ocrOnly(){
  if(!currentGeometry)return;rerun.disabled=true;runButton.disabled=true;
  try{setStatus("OCRを再実行しています…");currentOCR=await runOCR(source,currentGeometry,m=>{if(m?.status==="recognizing")setStatus(`OCR中: 領域 ${m.region}`)});output(currentOCR.out);renderRegions(currentOCR);debugRefresh();setStatus("OCR再実行完了")}catch(e){setStatus(`OCRエラー: ${e.message||e}`);debug.textContent=e.stack||String(e)}finally{runButton.disabled=false;rerun.disabled=false}
}
fileInput.addEventListener("change",e=>{const f=e.target.files?.[0];if(f)loadFile(f)});
runButton.addEventListener("click",run);rerun.addEventListener("click",ocrOnly);setupTabs();

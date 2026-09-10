import {cropCanvas,preprocessRegion,upscaleBinary} from './image.js';

const specs={
  A:{label:'楽曲タイトル',lang:'jpn+eng',psm:7,mode:'auto',post:s=>cleanTitle(s)},
  B:{label:'楽曲難易度',lang:'eng',psm:7,mode:'auto',post:s=>cleanDifficulty(s)},
  C:{label:'楽曲レベル',lang:'eng',psm:7,mode:'auto',post:s=>cleanInteger(s,1,99)},
  D:{label:'PERFECT',lang:'eng',psm:7,mode:'auto',post:s=>cleanInteger(s,0,9999)},
  E:{label:'GREAT',lang:'eng',psm:7,mode:'auto',post:s=>cleanInteger(s,0,9999)},
  F:{label:'GOOD',lang:'eng',psm:7,mode:'auto',post:s=>cleanInteger(s,0,9999)},
  G:{label:'BAD',lang:'eng',psm:7,mode:'auto',post:s=>cleanInteger(s,0,9999)},
  H:{label:'MISS',lang:'eng',psm:7,mode:'auto',post:s=>cleanInteger(s,0,9999)},
  I:{label:'COMBO',lang:'eng',psm:7,mode:'auto',post:s=>cleanInteger(s,0,9999)}
};

export async function createOCRManager(onProgress){
  if(!window.Tesseract)throw new Error('Tesseract.jsの読み込みに失敗しました。ネット接続を確認してください。');
  const workers={};
  async function getWorker(lang){if(workers[lang])return workers[lang]; const worker=await Tesseract.createWorker(lang,1,{logger:m=>{if(onProgress&&m.status)onProgress(m)}}); workers[lang]=worker; return worker}
  async function recognize(canvas,spec){
    let work=canvas;
    // Internal tightening improves OCR while keeping the displayed A〜I crop unchanged.
    if(spec.label==='楽曲タイトル' && canvas.width>200){work=cropCanvas(canvas,0,0,Math.round(canvas.width*.60),canvas.height)}
    if(spec.label==='COMBO' && canvas.width>180){work=cropCanvas(canvas,Math.round(canvas.width*.42),0,Math.round(canvas.width*.58),canvas.height)}
    const prep=preprocessRegion(work,spec.mode); const up=upscaleBinary(prep.canvas,2); const worker=await getWorker(spec.lang); await worker.setParameters({tessedit_pageseg_mode:String(spec.psm),preserve_interword_spaces:'0'}); const res=await worker.recognize(up); const raw=(res.data?.text||'').trim(); return {raw,cleaned:spec.post(raw),confidence:res.data?.confidence??null,processedCanvas:prep.canvas,invert:prep.invert};
  }
  return {recognize,terminate:async()=>{for(const w of Object.values(workers))await w.terminate()}};
}

function normalizeDigits(s){return String(s).replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xfee0)).replace(/[Oo]/g,'0').replace(/[Il|]/g,'1').replace(/[Ss]/g,'5').replace(/[Bb]/g,'8')}
function cleanInteger(s,min,max){const n=normalizeDigits(s).replace(/[^0-9]/g,'');if(!n)return '';const v=Number(n);return v>=min&&v<=max?String(v):n}
function cleanTitle(s){const t=String(s).replace(/[\n\r]+/g,' ').replace(/[|_~`]+/g,' ').trim();return (t.split(/\s{2,}/)[0]||t).replace(/\s+/g,' ').trim()}
function cleanDifficulty(s){const t=s.toUpperCase().replace(/[^A-Z]/g,''); if(t.includes('APPEND'))return 'APPEND'; if(t.includes('MASTER'))return 'MASTER'; if(t.includes('EXPERT'))return 'EXPERT'; if(t.includes('HARD'))return 'HARD'; if(t.includes('NORMAL'))return 'NORMAL'; if(t.includes('EASY'))return 'EASY'; return t}

export {specs};

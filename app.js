'use strict';

const $ = (s) => document.querySelector(s);
const state = { image:null, sourceCanvas:null, originalImageData:null, detection:null, regions:{}, debug:{}, ocr:{}, tesseractWorker:null };
window.prskState=state;
const COLORS = { red:'#ff2f3e', blue:'#1785ff', green:'#43e072', yellow:'#ffd24a', purple:'#b72ee8', pink:'#ff2e83', cyan:'#31d7ff' };

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const median=(a)=>{if(!a.length)return 0; const b=[...a].sort((x,y)=>x-y); const m=Math.floor(b.length/2); return b.length%2?b[m]:(b[m-1]+b[m])/2};
const percentile=(a,p)=>{if(!a.length)return 0; const b=[...a].sort((x,y)=>x-y); const i=(b.length-1)*p; const lo=Math.floor(i), hi=Math.ceil(i); return lo===hi?b[lo]:b[lo]+(b[hi]-b[lo])*(i-lo)};
const luma=(r,g,b)=>.2126*r+.7152*g+.0722*b;
const sat=(r,g,b)=>{const mx=Math.max(r,g,b),mn=Math.min(r,g,b); return mx? (mx-mn)/mx:0};
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

function setStatus(t,p){$('#status').textContent=t; $('#progressBar').style.width=`${clamp(p,0,100)}%`;}
function loadImage(file){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file);const img=new Image();img.onload=()=>{URL.revokeObjectURL(url);resolve(img)};img.onerror=reject;img.src=url;});}
function imageToCanvas(img){const c=document.createElement('canvas');c.width=img.naturalWidth||img.width;c.height=img.naturalHeight||img.height;c.getContext('2d',{willReadFrequently:true}).drawImage(img,0,0,c.width,c.height);return c;}

function reset(){state.image=null;state.sourceCanvas=null;state.originalImageData=null;state.detection=null;state.regions={};state.debug={};state.ocr={};$('#analyzeBtn').disabled=$('#detectBtn').disabled=$('#ocrBtn').disabled=true;$('#downloadDebug').disabled=$('#downloadImage').disabled=true;$('#regions').innerHTML='';$('#metricsTable tbody').innerHTML='';$('#debugOutput').textContent='';$('#ocrSummary').textContent='OCR結果はここに表示されます。';setStatus('画像を読み込んでください。',0);document.getElementById('overlayCanvas').removeAttribute('width');}

async function useFile(file){if(!file)return;try{setStatus('画像を読み込んでいます…',10);const img=await loadImage(file);state.image=img;state.sourceCanvas=imageToCanvas(img);state.originalImageData=state.sourceCanvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,state.sourceCanvas.width,state.sourceCanvas.height);$('#analyzeBtn').disabled=$('#detectBtn').disabled=$('#ocrBtn').disabled=false;setStatus(`読み込み完了: ${state.sourceCanvas.width} × ${state.sourceCanvas.height}`,100);drawOverlay();}catch(e){console.error(e);setStatus('画像の読み込みに失敗しました。',0);}}

function samplePixel(data,w,h,x,y,radius=1){x=clamp(Math.round(x),0,w-1);y=clamp(Math.round(y),0,h-1);const rs=[],gs=[],bs=[];for(let yy=-radius;yy<=radius;yy++){for(let xx=-radius;xx<=radius;xx++){const px=clamp(x+xx,0,w-1),py=clamp(y+yy,0,h-1),i=(py*w+px)*4;rs.push(data[i]);gs.push(data[i+1]);bs.push(data[i+2]);}}return [median(rs),median(gs),median(bs)];}
function scan(data,w,h,orientation,fixed,start,end,perpRadius=2){const out=[];const a=Math.round(start),b=Math.round(end);for(let q=a;q<=b;q++){let rgb; if(orientation==='v') rgb=samplePixel(data,w,h,fixed,q,perpRadius); else rgb=samplePixel(data,w,h,q,fixed,perpRadius);out.push({p:q,rgb,l:luma(...rgb),s:sat(...rgb),rgb});}return out;}
function smooth(vals,window=5){const n=vals.length,res=new Array(n);for(let i=0;i<n;i++){const a=Math.max(0,i-Math.floor(window/2)),b=Math.min(n,i+Math.ceil(window/2));res[i]=median(vals.slice(a,b));}return res;}
function lineRuns(values,predicate,minLen=3){const runs=[];let s=null;for(let i=0;i<values.length;i++){const ok=predicate(values[i],i);if(ok&&s===null)s=i;if((!ok||i===values.length-1)&&s!==null){const e=ok&&i===values.length-1?i:i-1;if(e-s+1>=minLen)runs.push([s,e]);s=null;}}return runs;}

function estimateFrame(data,w,h){
  const cx=Math.floor(w/2);
  const v=scan(data,w,h,'v',cx,0,Math.floor(h*.35),3);
  const topSamples= v.filter(z=>z.p<Math.max(10,Math.floor(h*.03))).map(z=>z.l);
  const panelL=median(v.filter(z=>z.p>Math.floor(h*.03)&&z.p<Math.floor(h*.15)).map(z=>z.l));
  const bgL=median(v.filter(z=>z.p>Math.floor(h*.16)&&z.p<Math.floor(h*.28)).map(z=>z.l));
  const threshold=bgL+(panelL-bgL)*.58;
  const runs=lineRuns(v,z=>z.l>threshold,Math.max(5,Math.round(h*.005)));
  let frameY;
  const candidate=runs.find(r=>r[0] < h*.08 && r[1]>h*.05);
  if(candidate) frameY=candidate[1];
  else {const dif=v.map((z,i)=>i?Math.abs(z.l-v[i-1].l):0);frameY=clamp(dif.indexOf(Math.max(...dif.slice(10,Math.floor(h*.3))))+10,1,h-1);}
  const y0=Math.max(0,Math.min(10,Math.floor(h*.005)));
  const hh=scan(data,w,h,'h',y0,0,w-1,3);
  const bgLh=median(hh.slice(0,Math.floor(w*.06)).map(z=>z.l));
  const panelLs=hh.slice(Math.floor(w*.15),Math.floor(w*.75)).map(z=>z.l);
  const panelMed=median(panelLs), thr=bgLh+(panelMed-bgLh)*.45;
  const hruns=lineRuns(hh,z=>z.l>thr,Math.max(8,Math.round(w*.004)));
  // The score-rank block interrupts the white header near the right side, so use the
  // first substantial panel run for the left edge and the last substantial run for the right edge.
  const leftRun=hruns.find(r=>r[0]<w*.22&&r[1]-r[0]>w*.12);
  const rightCandidates=hruns.filter(r=>r[1]>w*.84);
  const rightRun=rightCandidates.at(-1);
  const lx=leftRun?leftRun[0]:Math.floor(w*.093);
  const rx=rightRun?rightRun[1]:Math.floor(w*.918);
  return {whiteTopY:0,whiteBottomY:frameY,whiteLeftX:lx,whiteRightX:rx,whiteWidth:rx-lx,whiteHeight:frameY,scan:{frameVertical:v,frameHorizontal:hh,frameRuns:hruns}};
}

function detectGaugeStart(scanLine,startX,endX){
  const runs=lineRuns(scanLine,z=>{const [r,g,b]=z.rgb;return z.s>.28&&g>r*1.25&&g>=b*.96&&z.l>120;},8);
  const r=runs.find(x=>scanLine[x[0]].p>startX+18); return r?scanLine[r[0]].p:null;
}
function detectJacketRightAndGauge(data,w,h,frame){
  const y=Math.round(frame.whiteBottomY*.52);
  const s=scan(data,w,h,'h',y,frame.whiteLeftX+10,frame.whiteRightX-10,3);
  const baseline=median(s.filter(z=>z.p>frame.whiteLeftX+Math.round(frame.whiteWidth*.12)&&z.p<frame.whiteLeftX+Math.round(frame.whiteWidth*.72)).map(z=>z.l));
  // Jacket right edge: find the first long, stable return to the panel background after the jacket.
  const nearPanel=s.map(z=>Math.abs(z.l-baseline)<7 && z.s<.20);
  let jacketRight=null;
  for(let i=10;i<s.length-40;i++){
    if(nearPanel[i]){let j=i;while(j<s.length&&nearPanel[j])j++;if(j-i>=35){const prev=s[Math.max(0,i-8)].p;jacketRight=s[i].p;break;}}
  }
  if(jacketRight===null){const calm=lineRuns(s,z=>Math.abs(z.l-baseline)<7&&z.s<.20,20);const c=calm.find(r=>r[0]>s.length*.03);jacketRight=c?s[c[0]].p:frame.whiteLeftX+Math.round(frame.whiteWidth*.12);}
  const gaugeStart=detectGaugeStart(s,jacketRight,frame.whiteRightX)||frame.whiteLeftX+Math.round(frame.whiteWidth*.53);
  return {y, jacketRight, gaugeStart, scan:s};
}
function detectJacketVertical(data,w,h,frame,jacketRight){
  const x=jacketRight;
  const s=scan(data,w,h,'v',x,0,frame.whiteBottomY,3);
  // At this x the jacket border is a colored/non-panel block; find its longest contiguous block.
  const panel=median(s.filter(z=>z.p<h*.01).map(z=>z.l));
  const runs=lineRuns(s,z=>Math.abs(z.l-panel)>10 || z.s>.18,3);
  const candidates=runs.filter(r=>r[0]>2 && r[1]<frame.whiteBottomY-1).sort((a,b)=>(b[1]-b[0])-(a[1]-a[0]));
  const r=candidates[0]||[Math.round(frame.whiteBottomY*.09),Math.round(frame.whiteBottomY*.78)];
  return {jacketTopY:r[0],jacketBottomY:r[1],jacketHeight:r[1]-r[0],scan:s};
}
function detectTextPills(data,w,h,frame,jacketRight,gaugeStart,jacketTop,jacketBottom){
  const ys=[Math.round(jacketTop+(jacketBottom-jacketTop)*.52),Math.round(jacketTop+(jacketBottom-jacketTop)*.74)];
  const scans=ys.map(y=>scan(data,w,h,'h',y,jacketRight,gaugeStart,3));
  const scores={};
  for(const s of scans){for(let i=1;i<s.length;i++){const a=s[i-1],b=s[i];const mag=((b.rgb[0]+b.rgb[2])/2-b.rgb[1]);const change=Math.abs(b.l-a.l)+Math.abs(b.s-a.s)*80; if(change>18){scores[b.p]=(scores[b.p]||0)+change+Math.max(0,mag)*.2;}}}
  const xs=Object.entries(scores).map(([x,v])=>({x:+x,v})).sort((a,b)=>b.v-a.v).filter(o=>o.v>25).sort((a,b)=>a.x-b.x);
  const groups=[];for(const o of xs){const g=groups.at(-1);if(g&&o.x-g.at(-1).x<12)g.push(o);else groups.push([o]);}
  const centers=groups.map(g=>Math.round(g.reduce((s,o)=>s+o.x,0)/g.length));
  // Expected ordering is difficulty-left, difficulty-right/level-left, level-right.
  const candidates=centers.filter(x=>x>jacketRight+10&&x<gaugeStart-10);
  let bounds;
  if(candidates.length>=3){const triples=[];for(let i=0;i<=candidates.length-3;i++){const a=candidates[i],b=candidates[i+1],c=candidates[i+2];const span=c-a;if(span>gaugeStart-jacketRight*.2&&span<gaugeStart-jacketRight)triples.push([a,b,c]);}bounds=triples[0]||candidates.slice(0,3);}else bounds=[jacketRight+Math.round((gaugeStart-jacketRight)*.07),jacketRight+Math.round((gaugeStart-jacketRight)*.50),jacketRight+Math.round((gaugeStart-jacketRight)*.91)];
  // The screen has two internal dividers, so 4 boundaries. The outer left/right are reinforced by color-change runs.
  let dLeft=bounds[0], mid=bounds[1], dRight=bounds[2];
  const likely=[...candidates].sort((a,b)=>a-b); if(likely.length>=4){const mid1=likely[1],mid2=likely[2];dLeft=likely[0];dRight=likely[3];return {difficultyLeft:dLeft,difficultyRight:mid1,levelLeft:mid2,levelRight:dRight,scanLines:scans};}
  return {difficultyLeft:dLeft,difficultyRight:mid,levelLeft:mid+1,levelRight:dRight,scanLines:scans};
}
function detectJudgeRows(data,w,h,frame,gaugeStart,goodLeftGuess){
  // Step 9 nominal scan: extend the detected jacket/gauge-left line vertically.
  const x=clamp(Math.round(gaugeStart),frame.whiteLeftX+20,w-4);
  const s=scan(data,w,h,'v',x,frame.whiteBottomY+4,Math.floor(h*.88),4);
  // Support scan around the judgment labels. It is intentionally wider than one pixel so
  // isolated glyphs, compression blocks, and thin decorative lines do not determine an edge.
  const left=Math.round(frame.whiteLeftX+w*.024);
  const right=Math.round(frame.whiteLeftX+w*.230);
  const yStart=Math.round(frame.whiteBottomY+h*.37), yEnd=Math.min(Math.floor(h*.82),Math.round(frame.whiteBottomY+h*.72));
  const profile=[];
  for(let y=yStart;y<=yEnd;y++){
    let n=0,total=0;
    for(let xx=left;xx<=right;xx++){
      const p=samplePixel(data,w,h,xx,y,1); const ll=luma(...p), ss=sat(...p);
      total += ((ss>.20&&ll>82)||(ll>145)) ? 1 : 0; n++;
    }
    profile.push(total/Math.max(1,n));
  }
  const sm=smooth(profile,5);
  const threshold=Math.max(.045,percentile(sm,.55)*.60);
  const runs=lineRuns(sm.map(v=>({v})),z=>z.v>=threshold,7);
  // Merge fragments of the same text row.
  const merged=[];
  for(const r of runs){const last=merged.at(-1);if(last&&r[0]-last[1]<=Math.round(h*.008))last[1]=r[1];else merged.push([...r]);}
  const rowRuns=merged.filter(r=>r[1]-r[0]+1>=18).sort((a,b)=>(b[1]-b[0])-(a[1]-a[0])).slice(0,7).sort((a,b)=>a[0]-b[0]);
  let centers=rowRuns.map(r=>Math.round((yStart+r[0]+yStart+r[1])/2));
  // Remove accidental fragments and choose five approximately equidistant row centers.
  const filtered=[];for(const c of centers){const last=filtered.at(-1);if(!last||c-last>Math.round(h*.025))filtered.push(c);}
  centers=filtered;
  if(centers.length>5){
    let best=null;for(let i=0;i<=centers.length-5;i++){const seq=centers.slice(i,i+5);const gaps=seq.slice(1).map((v,j)=>v-seq[j]);const mean=gaps.reduce((a,b)=>a+b,0)/gaps.length;const err=gaps.reduce((a,b)=>a+Math.abs(b-mean),0);if(!best||err<best.err)best={seq,err};}centers=best.seq;
  }
  if(centers.length<5){const step=Math.round(h*.049), start=Math.round(frame.whiteBottomY+h*.425);centers=Array.from({length:5},(_,i)=>start+i*step);}
  const edges=[];
  edges[0]=Math.round(centers[0]-(centers[1]-centers[0])/2);
  for(let i=1;i<centers.length;i++)edges[i]=Math.round((centers[i-1]+centers[i])/2);
  edges.push(Math.round(centers.at(-1)+(centers.at(-1)-centers.at(-2))/2));
  return {perfectTop:edges[0],perfectBottom:edges[1],goodTop:edges[2],goodBottom:edges[3],missTop:edges[4],missBottom:edges[5],scan:s,x,edgeProfile:profile,candidateEdges:filtered,rowCenters:centers};
}

function detectJudgeColumns(data,w,h,frame,gaugeStart,rows){
  const y=Math.round((rows.goodTop+rows.goodBottom)/2);
  const s=scan(data,w,h,'h',y,frame.whiteLeftX,gaugeStart-2,4);
  const raw=s.map(z=>z.l);
  const sm=smooth(raw,15);
  const outside=median(sm.slice(0,Math.max(10,Math.round(sm.length*.08))));
  const threshold=outside+5;
  const runs=lineRuns(sm.map(v=>({v})),z=>z.v>threshold,18);
  const candidates=runs.map(r=>[s[r[0]].p,s[r[1]].p]).filter(r=>r[0]>frame.whiteLeftX+15);
  const label=candidates.find(r=>r[1]-r[0]>100&&r[0]<frame.whiteLeftX+frame.whiteWidth*.45) || [frame.whiteLeftX+40,frame.whiteLeftX+Math.round(frame.whiteWidth*.31)];
  // LATE/FAST is the next panel immediately to the right of the judgment rows.
  const lateFastLeft=Math.min(gaugeStart-30,Math.round(label[1]+Math.max(25,w*.012)));
  return {goodLeft:label[0],goodRight:label[1],lateFastLeft,scan:s,smoothedLuma:sm,threshold};
}

function buildRegions(d,w,h){
  const X=d.x,Y=d.y;
  const R={
    A:[X.jacketRight,Y.jacketTop,d.frame.whiteRightX,Y.jacketMid],
    B:[X.jacketRight,Y.jacketMid,X.difficultyLeft,Y.jacketBottom],
    C:[X.levelLeft,Y.jacketMid,X.levelRight,Y.jacketBottom],
    D:[X.goodLeft,Y.perfectTop,X.goodRight,Y.perfectBottom],
    E:[X.goodLeft,Y.perfectBottom,X.goodRight,Y.goodBottom],
    F:[X.goodLeft,Y.goodTop,X.goodRight,Y.goodBottom],
    G:[X.goodLeft,Y.goodBottom,X.goodRight,Y.missTop],
    H:[X.goodLeft,Y.missTop,X.goodRight,Y.missBottom],
    I:[X.lateFastLeft,Y.perfectTop,X.gaugeStart,Y.perfectBottom]
  };
  return R;
}
function cropCanvas(src,rect,scale=1){const [x1,y1,x2,y2]=rect;const x=clamp(Math.floor(Math.min(x1,x2)),0,src.width-1),y=clamp(Math.floor(Math.min(y1,y2)),0,src.height-1),w=clamp(Math.ceil(Math.abs(x2-x1)),1,src.width-x),h=clamp(Math.ceil(Math.abs(y2-y1)),1,src.height-y);const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w*scale));c.height=Math.max(1,Math.round(h*scale));c.getContext('2d').drawImage(src,x,y,w,h,0,0,c.width,c.height);return c;}
function grayscaleAndThreshold(src,kind){const w=src.width,h=src.height,ctx=src.getContext('2d',{willReadFrequently:true}),d=ctx.getImageData(0,0,w,h),gray=new Uint8ClampedArray(w*h);let vals=[];for(let i=0;i<w*h;i++){const r=d.data[i*4],g=d.data[i*4+1],b=d.data[i*4+2];let v=luma(r,g,b); if(kind==='magenta')v=clamp((b+r-2*g)*0.75+v*.35,0,255); if(kind==='cyan')v=clamp((g+b-2*r)*.75+v*.35,0,255);gray[i]=v;vals.push(v);}const lo=percentile(vals,.12),hi=percentile(vals,.88),thr=(lo+hi)/2;const variants=[];for(const inv of [false,true]){const out=document.createElement('canvas');out.width=w;out.height=h;const od=out.getContext('2d').createImageData(w,h);for(let i=0;i<w*h;i++){let v=gray[i];if(inv)v=255-v;let bw=v>thr?255:0;od.data[i*4]=od.data[i*4+1]=od.data[i*4+2]=bw;od.data[i*4+3]=255;}out.getContext('2d').putImageData(od,0,0);variants.push({canvas:out,invert:inv,threshold:thr,lo,hi});}return {gray,variants,best:variants[0]};}

function mapRegionKind(key){return ['D','E','F','G','H'].includes(key)?'cyan':['I'].includes(key)?'normal':['B','C'].includes(key)?'magenta':'normal'}
function renderRegions(){const wrap=$('#regions');wrap.innerHTML='';for(const key of Object.keys(state.regions)){const info=state.regions[key],div=document.createElement('article');div.className='region';const title=document.createElement('h3');title.innerHTML=`<span>領域 ${key}</span><span>${info.ocr?.text||'—'}</span>`;div.appendChild(title);const meta=document.createElement('div');meta.className='meta';meta.textContent=`${info.rect.map(n=>Math.round(n)).join(', ')} / 前処理: ${info.preprocessing}`;div.appendChild(meta);const grid=document.createElement('div');grid.className='crop-grid';for(const [cap,can] of [['処理前',info.raw],['処理後',info.binary]]){const fig=document.createElement('figure');const fc=document.createElement('figcaption');fc.textContent=cap;fig.appendChild(fc);const c=document.createElement('canvas');c.width=can.width;c.height=can.height;c.getContext('2d').drawImage(can,0,0);fig.appendChild(c);grid.appendChild(fig);}div.appendChild(grid);const o=document.createElement('div');o.className='ocr-line';o.innerHTML=`OCR: <strong>${escapeHtml(info.ocr?.text||'—')}</strong> <span>(${info.ocr?.confidence!=null?info.ocr.confidence.toFixed(1):'—'})</span>`;div.appendChild(o);wrap.appendChild(div);}}
const escapeHtml=s=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

function drawOverlay(){const src=state.sourceCanvas;if(!src)return;const can=$('#overlayCanvas');can.width=src.width;can.height=src.height;const ctx=can.getContext('2d');ctx.drawImage(src,0,0);if(!state.detection||!$('#showScan').checked)return;const d=state.detection;ctx.save();ctx.lineWidth=Math.max(2,src.width/700);ctx.globalAlpha=.9;const line=(x1,y1,x2,y2,c,w=3)=>{ctx.strokeStyle=c;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke()};
  const {frame,jacket,pills,jRows,jCols}=d;
  // Thin scan lines (actual sampling locations)
  line(src.width/2,0,src.width/2,frame.whiteBottomY,COLORS.red,2);
  line(frame.whiteLeftX,0,frame.whiteRightX,0,COLORS.blue,2);
  line(frame.whiteLeftX,jacket.y,frame.whiteRightX,jacket.y,COLORS.green,2);
  line(jacket.jacketRight,0,jacket.jacketRight,frame.whiteBottomY,COLORS.yellow,2);
  for(const s of pills.scanLines) line(frame.whiteLeftX,s.p,frame.whiteRightX,s.p,COLORS.purple,2);
  line(jacket.jacketRight,frame.whiteBottomY,jacket.jacketRight,src.height,COLORS.pink,2);
  line(frame.whiteLeftX,jCols.y,jacket.gaugeStart,jCols.y,COLORS.cyan,2);
  // Thick detected boundaries
  line(frame.whiteLeftX,frame.whiteBottomY,frame.whiteRightX,frame.whiteBottomY,COLORS.red,5);
  line(frame.whiteLeftX,0,frame.whiteLeftX,src.height,COLORS.blue,5);
  line(frame.whiteRightX,0,frame.whiteRightX,src.height,COLORS.blue,5);
  // Both jacket-right and gauge-left are green, as specified.
  line(jacket.jacketRight,0,jacket.jacketRight,src.height,COLORS.green,5);
  line(jacket.gaugeStart,0,jacket.gaugeStart,src.height,COLORS.green,5);
  line(jacket.jacketRight,jacket.jacketTopY,jacket.gaugeStart,jacket.jacketTopY,COLORS.yellow,4);
  line(jacket.jacketRight,jacket.jacketBottomY,jacket.gaugeStart,jacket.jacketBottomY,COLORS.yellow,4);
  for(const x of [pills.difficultyLeft,pills.difficultyRight,pills.levelLeft,pills.levelRight]) line(x,jacket.jacketMid,x,jacket.jacketBottomY,COLORS.purple,3);
  for(const y of [jRows.perfectTop,jRows.perfectBottom,jRows.goodTop,jRows.goodBottom,jRows.missTop,jRows.missBottom]) line(frame.whiteLeftX,y,jacket.gaugeStart,y,COLORS.pink,4);
  for(const x of [jCols.goodLeft,jCols.goodRight,jCols.lateFastLeft]) line(x,jRows.perfectTop,x,jRows.missBottom,COLORS.cyan,4);
  ctx.restore();
}

function metrics(){const d=state.detection,tbody=$('#metricsTable tbody');tbody.innerHTML='';const items=[
 ['白枠下端',d.frame.whiteBottomY,'高'],['白枠左端',d.frame.whiteLeftX,'高'],['白枠右端',d.frame.whiteRightX,'高'],['白枠横幅',d.frame.whiteWidth,'高'],['白枠縦幅',d.frame.whiteHeight,'高'],['ジャケット右端',d.jacket.jacketRight,'中'],['ゲージ左端',d.jacket.gaugeStart,'高'],['ジャケット上端',d.jacket.jacketTopY,'中'],['ジャケット下端',d.jacket.jacketBottomY,'中'],['ジャケット縦幅',d.jacket.jacketHeight,'中'],['難易度左',d.pills.difficultyLeft,'中'],['難易度右',d.pills.difficultyRight,'中'],['レベル左',d.pills.levelLeft,'中'],['レベル右',d.pills.levelRight,'中'],['PERFECT上',d.jRows.perfectTop,'中'],['PERFECT下',d.jRows.perfectBottom,'中'],['GOOD上',d.jRows.goodTop,'中'],['GOOD下',d.jRows.goodBottom,'中'],['MISS上',d.jRows.missTop,'中'],['MISS下',d.jRows.missBottom,'中'],['GOOD左',d.jCols.goodLeft,'中'],['GOOD右',d.jCols.goodRight,'中'],['LATE/FAST左',d.jCols.lateFastLeft,'低']];for(const [a,b,c] of items){const tr=document.createElement('tr');tr.innerHTML=`<td>${a}</td><td>${Math.round(b)}</td><td>${c}</td>`;tbody.appendChild(tr)}}

function detectAll(){const {data,width:w,height:h}=state.originalImageData;setStatus('①② 白枠を検出中…',15);const frame=estimateFrame(data,w,h);setStatus('③ ゲージ・ジャケット右端を検出中…',30);const jacket=detectJacketRightAndGauge(data,w,h,frame);setStatus('④ ジャケット上下端を検出中…',45);const jv=detectJacketVertical(data,w,h,frame,jacket.jacketRight);jacket.jacketTopY=jv.jacketTopY;jacket.jacketBottomY=jv.jacketBottomY;jacket.jacketHeight=jv.jacketHeight;jacket.jacketMid=(jv.jacketTopY+jv.jacketBottomY)/2;setStatus('⑤ 難易度・レベル境界を検出中…',58);const pills=detectTextPills(data,w,h,frame,jacket.jacketRight,jacket.gaugeStart,jv.jacketTopY,jv.jacketBottomY);setStatus('⑨ 判定行を検出中…',70);const jRows=detectJudgeRows(data,w,h,frame,jacket.gaugeStart,null);setStatus('⑩ 判定列を検出中…',80);const jCols=detectJudgeColumns(data,w,h,frame,jacket.gaugeStart,jRows);const d={frame,jacket,pills,jRows,jCols,x:{jacketRight:jacket.jacketRight,gaugeStart:jacket.gaugeStart,difficultyLeft:pills.difficultyLeft,difficultyRight:pills.difficultyRight,levelLeft:pills.levelLeft,levelRight:pills.levelRight,goodLeft:jCols.goodLeft,goodRight:jCols.goodRight,lateFastLeft:jCols.lateFastLeft},y:{jacketTop:jv.jacketTopY,jacketBottom:jv.jacketBottomY,jacketMid:jacket.jacketMid,perfectTop:jRows.perfectTop,perfectBottom:jRows.perfectBottom,goodTop:jRows.goodTop,goodBottom:jRows.goodBottom,missTop:jRows.missTop,missBottom:jRows.missBottom}};state.detection=d;state.regions={};const regs=buildRegions(d,w,h);for(const key of Object.keys(regs)){const raw=cropCanvas(state.sourceCanvas,regs[key],1.5);const prep=grayscaleAndThreshold(raw,mapRegionKind(key));const best=chooseBinary(prep,key);state.regions[key]={rect:regs[key],raw,binary:best.canvas,preprocessing:`gray + ${best.invert?'反転':''}threshold=${best.threshold.toFixed(1)}`,prep,ocr:null};}state.debug=makeDebug();metrics();renderRegions();drawOverlay();$('#downloadDebug').disabled=$('#downloadImage').disabled=false;setStatus('位置検出完了。',100);}
function chooseBinary(prep,key){ // Prefer the variant with a reasonable ink ratio, avoiding fully black/white crops.
  const scores=prep.variants.map(v=>{const c=v.canvas.getContext('2d').getImageData(0,0,v.canvas.width,v.canvas.height).data;let white=0;for(let i=0;i<c.length;i+=4)if(c[i]>128)white++;const ratio=white/(c.length/4);return {...v,score:Math.abs(ratio-.28)};});scores.sort((a,b)=>a.score-b.score);return scores[0];}

async function ensureWorker(){if(state.tesseractWorker)return state.tesseractWorker;if(!window.Tesseract)throw new Error('Tesseract.jsが読み込まれていません。インターネット接続を確認してください。');setStatus('OCRエンジンを準備中…',5);const worker=await Tesseract.createWorker('jpn+eng',1,{logger:m=>{if(m.status){const p=m.progress?Math.round(m.progress*100):0;setStatus(`OCRエンジン: ${m.status} ${p}%`,Math.max(5,p*.2));}}});state.tesseractWorker=worker;return worker;}
function normalizeOCR(key,text){let s=String(text||'').replace(/\s+/g,' ').trim();if(['D','E','F','G','H'].includes(key)){s=s.replace(/[^0-9]/g,'');}if(key==='C'){s=s.replace(/\s/g,'').replace(/楽曲?LV[.:：]?/i,'').trim();}if(key==='B')s=s.toUpperCase().replace(/[^A-Z]/g,'');if(key==='I')s=s.replace(/[^0-9]/g,'');return s;}
async function ocrRegion(worker,key,info){const psm=(key==='A'?6:10);await worker.setParameters({tessedit_pageseg_mode:String(psm),preserve_interword_spaces:'1'});const {data}=await worker.recognize(info.binary);let text=normalizeOCR(key,data.text);let conf=data.confidence;
  // Try the opposite polarity / original if the first pass looks implausible.
  const alternatives=[];if(!text || (['D','E','F','G','H','I'].includes(key)&&text.length<1))alternatives.push(info.raw);if(key==='A'&&text.length<2)alternatives.push(info.raw);
  for(const can of alternatives){const r=await worker.recognize(can);const t=normalizeOCR(key,r.data.text);if(t.length>text.length){text=t;conf=r.data.confidence;}}
  return {text,confidence:conf};}
function applyResults(){const map={A:'rTitle',B:'rDifficulty',C:'rLevel',D:'rPerfect',E:'rGreat',F:'rGood',G:'rBad',H:'rMiss',I:'rCombo'};for(const [k,id] of Object.entries(map))$( '#'+id).textContent=state.regions[k]?.ocr?.text||'—';const details=Object.entries(state.regions).map(([k,v])=>`${k}: ${v.ocr?.text||'—'} (${v.ocr?.confidence?.toFixed(1)??'—'})`).join(' | ');$('#ocrSummary').textContent=details;renderRegions();}
async function ocrAll(){try{const worker=await ensureWorker();const keys=Object.keys(state.regions);if(!keys.length)throw new Error('先に位置検出を実行してください。');for(let i=0;i<keys.length;i++){const k=keys[i];setStatus(`⑰ 領域 ${k} をOCR中…`,10+Math.round(i/keys.length*85));state.regions[k].ocr=await ocrRegion(worker,k,state.regions[k]);}applyResults();state.debug=makeDebug();renderDebug();setStatus('OCR完了。',100);}catch(e){console.error(e);setStatus(`OCRに失敗しました: ${e.message}`,0);$('#ocrSummary').textContent='OCRに失敗。コンソールのエラー詳細も確認してください。';}}
function makeDebug(){const d=state.detection;return {image:{width:state.sourceCanvas.width,height:state.sourceCanvas.height},detection:{frame:d.frame,jacket:d.jacket,pills:d.pills,jRows:d.jRows,jCols:d.jCols},regions:Object.fromEntries(Object.entries(state.regions).map(([k,v])=>[k,{rect:v.rect,preprocessing:v.preprocessing,ocr:v.ocr||null}])),notes:['位置検出は複数ピクセルの中央値・連続幅・局所コントラストを利用。','画像の縮尺が変わっても座標は元画像ピクセルで保持。','自動検出が難しい画像では、Debug/スキャン値を確認して閾値を調整してください。']};}
function renderDebug(){const t=$('#debugType').value;let out; if(t==='summary')out=JSON.stringify(state.debug,null,2);else if(t==='ocr')out=JSON.stringify(state.ocr,null,2);else if(t==='scan')out=JSON.stringify({frameVertical:state.detection?.frame.scan?.frameVertical,frameHorizontal:state.detection?.frame.scan?.frameHorizontal,jacketScan:state.detection?.jacket.scan,pillScans:state.detection?.pills.scanLines,jRows:state.detection?.jRows.scan,jCols:state.detection?.jCols.scan},null,2);else {out=JSON.stringify(Object.fromEntries(Object.entries(state.regions).map(([k,v])=>[k,{threshold:v.prep?.best?.threshold,lo:v.prep?.best?.lo,hi:v.prep?.best?.hi,ocr:v.ocr}])),null,2);}$('#debugOutput').textContent=out;}
function downloadBlob(name,blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}

function init(){
  $('#fileInput').addEventListener('change',e=>useFile(e.target.files[0]));
  $('#loadSample').addEventListener('click',async()=>{const img=await loadImage('sample.png').catch(()=>null);if(img){state.image=img;state.sourceCanvas=imageToCanvas(img);state.originalImageData=state.sourceCanvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,state.sourceCanvas.width,state.sourceCanvas.height);$('#analyzeBtn').disabled=$('#detectBtn').disabled=$('#ocrBtn').disabled=false;setStatus('サンプル読み込み完了。',100);drawOverlay();}else alert('同梱サンプルを読み込めませんでした。画像選択をご利用ください。');});
  $('#dropZone').addEventListener('dragover',e=>{e.preventDefault();$('#dropZone').classList.add('over')});$('#dropZone').addEventListener('dragleave',()=>$('#dropZone').classList.remove('over'));$('#dropZone').addEventListener('drop',e=>{e.preventDefault();$('#dropZone').classList.remove('over');useFile(e.dataTransfer.files[0])});
  $('#analyzeBtn').addEventListener('click',async()=>{detectAll();await ocrAll()});$('#detectBtn').addEventListener('click',()=>detectAll());$('#ocrBtn').addEventListener('click',()=>ocrAll());$('#resetBtn').addEventListener('click',reset);$('#showScan').addEventListener('change',drawOverlay);$('#debugType').addEventListener('change',renderDebug);
  $('#downloadDebug').addEventListener('click',()=>downloadBlob('prsk-debug.json',new Blob([JSON.stringify(state.debug||makeDebug(),null,2)],{type:'application/json'})));$('#downloadImage').addEventListener('click',()=>$('#overlayCanvas').toBlob(b=>downloadBlob('prsk-scan-overlay.png',b),'image/png'));
}
document.addEventListener('DOMContentLoaded',init);

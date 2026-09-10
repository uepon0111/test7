import {clamp,median,mean,smooth,rgbDist,getRGB,canvasData} from "./image.js";

function lineSamples(data,w,h,axis,pos,half=3,rangeStart=0,rangeEnd=null){
  rangeEnd ??= axis==="x"?w:h;
  const arr=[];const start=Math.max(0,Math.floor(rangeStart)),end=Math.min(axis==="x"?w:h,Math.ceil(rangeEnd));
  for(let i=start;i<end;i++){let vals=[];for(let q=-half;q<=half;q++){let x=axis==="x"?i:clamp(pos+q,0,w-1),y=axis==="x"?clamp(pos+q,0,h-1):i;vals.push(getRGB(data,w,x,y))}
    arr.push([i,vals.reduce((a,v)=>[a[0]+v[0],a[1]+v[1],a[2]+v[2]],[0,0,0]).map(v=>v/vals.length)]);
  }return arr;
}
function edgePositions(profile,direction="both",minGap=20){const p=smooth(profile.map(v=>v[1]),4),g=[];for(let i=1;i<p.length;i++)g.push(p[i]-p[i-1]);let bestPos=-1,best=-Infinity;if(direction==="down"||direction==="both")for(let i=10;i<g.length-10;i++)if(g[i]>best){best=g[i];bestPos=i+1}if(direction==="up"||direction==="both"){let bp=-1,bv=Infinity;for(let i=10;i<g.length-10;i++)if(g[i]<bv){bv=g[i];bp=i+1}if(bestPos<0||Math.abs(bp-bestPos)>minGap)bestPos=direction==="up"?bp:bestPos}return {p,g,pos:bestPos,best}}
function panelBounds(data,w,h){
  const xs=[];for(let k=-3;k<=3;k++)xs.push(Math.floor(w/2+k*Math.max(1,w*.004)));
  const bottoms=[];for(const x of xs){const prof=lineSamples(data,w,h,"y",x,2,0,Math.min(h,h*.45)).map(([i,r])=>[i,.299*r[0]+.587*r[1]+.114*r[2]]);const {g}=edgePositions(prof);let cand=[];for(let i=20;i<g.length-10;i++){const before=mean(prof.slice(Math.max(0,i-12),i).map(v=>v[1])),after=mean(prof.slice(i,i+12).map(v=>v[1]));if(before-after>18)cand.push({i,b:before-after})}if(cand.length)bottoms.push(cand.sort((a,b)=>b.b-a.b)[0].i)}const bottom=median(bottoms.length?bottoms.map(v=>v):[Math.round(h*.132)]);return {left:0,top:0,right:w,bottom:bottom,height:bottom,width:w,confidence:bottoms.length/7}}
function headerX(data,w,h,y){
  const ys=[];for(let k=-4;k<=4;k++)ys.push(clamp(y+k*2,0,h-1));const lefts=[],rights=[];
  for(const yy of ys){const prof=lineSamples(data,w,h,"x",yy,0,0,w).map(([i,r])=>[i,.299*r[0]+.587*r[1]+.114*r[2]]);const sm=smooth(prof.map(v=>v[1]),5),grad=sm.map((v,i)=>i? v-sm[i-1]:0);let lp=grad.slice(30,Math.floor(w*.45)).reduce((bi,v,i)=>v>grad[bi+30]?i+30:bi,30);let rp=grad.slice(Math.floor(w*.55),w-30).reduce((bi,v,i)=>v<grad[bi]?i+Math.floor(w*.55):bi,Math.floor(w*.55));lefts.push(lp);rights.push(rp)}return {left:median(lefts),right:median(rights)}
}
function saturation(rgb){const mx=Math.max(...rgb),mn=Math.min(...rgb);return mx?((mx-mn)/mx)*255:0}
function jacketAndGauge(data,w,h,panel){
  const y0=Math.round(panel.bottom*.52), y1=Math.round(panel.bottom*.75);
  const jacketCandidates=[],gaugeCandidates=[];
  for(const y of [y0,y1]){const vals=[];for(let x=panel.left+10;x<panel.right-10;x++){let maxS=0;for(let dy=-4;dy<=4;dy++)maxS=Math.max(maxS,saturation(getRGB(data,w,x,clamp(y+dy,0,h-1))));vals.push([x,maxS])}const sm=smooth(vals.map(v=>v[1]),10);let runs=[],st=null;for(let i=0;i<sm.length;i++){const on=sm[i]>62;if(on&&st===null)st=i;if(st!==null&&(!on||i===sm.length-1)){const e=!on?i:i+1;if(e-st>=18)runs.push({l:vals[st][0],r:vals[e-1][0]+1,w:e-st,s:mean(sm.slice(st,e))});st=null}
    // Jacket texture is interrupted by light/dark pixels, so merge nearby runs.
    const merged=[];for(const r of runs){const last=merged[merged.length-1];if(last&&r.l-last.r<=58&&r.l<w*.5){last.r=r.r;last.w=last.r-last.l;last.s=Math.max(last.s,r.s)}else merged.push({...r})}
    const js=merged.filter(r=>r.l>w*.07&&r.l<w*.30&&r.w>=90&&r.w<=260).sort((a,b)=>b.w-a.w)[0];if(js)jacketCandidates.push(js);
    const gs=runs.filter(r=>r.w>=300).sort((a,b)=>b.w-a.w)[0];if(gs)gaugeCandidates.push(gs);
  }
  const j=jacketCandidates.sort((a,b)=>a.l-b.l)[0]||{l:w*.116,r:w*.185,w:w*.069};const g=gaugeCandidates.sort((a,b)=>b.w-a.w)[0]||{l:w*.528,r:w*.798,w:w*.27};
  return {jacketLeft:j.l,jacketRight:j.r,gaugeLeft:g.l,gaugeRight:g.r,scanY:[y0,y1],confidence:{jacket:jacketCandidates.length/2,gauge:gaugeCandidates.length/2}}
}
function diffLevel(panel,jacket,gauge,data,w,h){
  const yTop=Math.round(panel.bottom*.54),yBottom=Math.round(panel.bottom*.86);
  const p=[];for(let x=jacket.jacketRight+8;x<gauge.gaugeLeft-8;x++){
    let rs=[];for(let y=yTop;y<=yBottom;y++)rs.push(getRGB(data,w,x,y));
    const m=rs.reduce((a,v)=>[a[0]+v[0],a[1]+v[1],a[2]+v[2]],[0,0,0]).map(v=>v/rs.length);
    p.push([x,rgbDist(m,[171,172,191]),m]);
  }
  const sm=smooth(p.map(v=>v[1]),12);
  let start=-1,end=-1;
  for(let i=10;i<sm.length-10;i++){
    if(sm[i]>25){start=p[i][0];break}
  }
  if(start<0)start=jacket.jacketRight+25;
  for(let i=Math.max(10,(start-(jacket.jacketRight+8)));i<sm.length-10;i++){
    if(sm[i]<18&&p[i][0]>start+80){end=p[i][0];break}
  }
  if(end<0)end=Math.min(gauge.gaugeLeft-15,start+420);

  // Difficulty and level are adjacent blocks. Find their strongest color/luminance boundary.
  const l0=Math.max(start+80,Math.floor((start+end)*.35));
  const l1=Math.min(end-50,Math.ceil((start+end)*.75));
  let boundary=-1,best=-Infinity;
  for(let i=Math.max(1,l0-(jacket.jacketRight+8));i<Math.min(sm.length-1,l1-(jacket.jacketRight+8));i++){
    const a=p[i-1][2],b=p[i][2];
    const d=rgbDist(a,b);
    if(d>best){best=d;boundary=p[i][0]}
  }
  if(boundary<0||boundary<=start+60||boundary>=end-40)boundary=Math.round(start+(end-start)*.50);
  return {difficultyLeft:start,difficultyRight:boundary,levelLeft:boundary,levelRight:end,scanYs:[yTop,yBottom],runs:[{l:start,r:end,w:end-start,boundary}]}
}
function countRows(data,w,h,panel,jacket){
  const x=Math.round(jacket.jacketRight);
  const yStart=Math.round(panel.bottom+Math.max(35,h*.34)),yEnd=Math.min(h-10,yStart+h*.32);
  const prof=[];for(let y=yStart;y<yEnd;y++){
    let vals=[];for(let dx=-12;dx<=12;dx++){
      const c=getRGB(data,w,clamp(x+dx,0,w-1),y);
      vals.push(.299*c[0]+.587*c[1]+.114*c[2]);
    }
    prof.push([y,median(vals)]);
  }
  const sm=smooth(prof.map(v=>v[1]),4),grad=sm.map((v,i)=>i?v-sm[i-1]:0);
  const positives=[];
  for(let i=8;i<grad.length-8;i++)if(grad[i]>3.0)positives.push({y:prof[i][0],g:grad[i]});
  // Cluster nearby positive edges and keep the strongest edge of each cluster.
  const clusters=[];for(const e of positives){const last=clusters[clusters.length-1];if(last&&e.y-last[last.length-1].y<12)last.push(e);else clusters.push([e])}
  const tops=clusters.map(c=>c.sort((a,b)=>b.g-a.g)[0]).sort((a,b)=>a.y-b.y);
  let top=tops.find(e=>e.y>yStart+20)?.y;
  let second=top?tops.find(e=>e.y>top+42&&e.y<top+90)?.y:null;
  if(top==null)top=Math.round(panel.bottom+h*.398);
  if(second==null)second=top+Math.round(h*.047);
  const pitch=clamp(Math.round(second-top),48,82);
  // Row height is obtained from the first box's falling edge, constrained to a plausible 45–75 px.
  const neg=[];for(let i=8;i<grad.length-8;i++)if(grad[i]<-3.0&&prof[i][0]>top+35&&prof[i][0]<top+78)neg.push({y:prof[i][0],g:grad[i]});
  let bottom=neg.sort((a,b)=>a.y-b.y)[0]?.y;
  if(bottom==null)bottom=top+clamp(Math.round(pitch*.92),45,72);
  const height=clamp(bottom-top,45,72);
  const rows=[];for(let i=0;i<5;i++){const t=top+i*pitch;rows.push({top:t,bottom:t+height})}
  return {perfectTop:rows[0].top,perfectBottom:rows[0].bottom,goodTop:rows[2].top,goodBottom:rows[2].bottom,missTop:rows[4].top,missBottom:rows[4].bottom,rowPitch:pitch,rows,scanX:x}
}
function resultBoxes(data,w,h,panel,jacket,rows,gauge){
  const y=Math.round((rows.goodTop+rows.goodBottom)/2), band=8, p=[];
  for(let x=panel.left+20;x<gauge.gaugeLeft-5;x++){let vals=[];for(let yy=y-band;yy<=y+band;yy++){const c=getRGB(data,w,x,clamp(yy,0,h-1));vals.push(.299*c[0]+.587*c[1]+.114*c[2])}p.push([x,mean(vals)])}
  const sm=smooth(p.map(v=>v[1]),12);const base=median(sm.slice(0,30).concat(sm.slice(-30)));const runs=[];let st=null;for(let i=0;i<sm.length;i++){const on=sm[i]>base+3.0;if(on&&st===null)st=i;if(st!==null&&(!on||i===sm.length-1)){const e=!on?i:i+1;if(e-st>80)runs.push({l:p[st][0],r:p[e-1][0]+1,w:e-st,score:mean(sm.slice(st,e))});st=null}}
  const r1=runs.filter(r=>r.l<jacket.jacketRight+30)[0]||{l:panel.left+40,r:jacket.jacketRight+260};const r2=runs.find(r=>r.l>r1.r+20)||{l:r1.r+45,r:gauge.gaugeLeft-30};
  return {goodLeft:r1.l,goodRight:r1.r,lateFastLeft:r2.l,profile:{base,runs}}
}
export function detectGeometry(canvas){
  const d=canvasData(canvas),{width:w,height:h}=d,data=d.data;
  const panel=panelBounds(data,w,h);
  const header=headerX(data,w,h,Math.max(5,Math.min(25,Math.round(h*.015))));
  const p={...panel,left:header.left,right:header.right,width:header.right-header.left};
  const jg=jacketAndGauge(data,w,h,p);
  const dl=diffLevel(p,jg,data,w,h);
  const rows=countRows(data,w,h,p,jg);
  const boxes=resultBoxes(data,w,h,p,jg,rows,jg);
  const jacketCenter=Math.round((jg.jacketLeft+jg.jacketRight)/2);
  const jacketTop=Math.max(0,Math.round(p.top));
  const jacketBottom=Math.min(h,Math.round(jacketTop+p.height*.86)); // overwritten by scan below
  const jTop = Math.round(p.top + p.height*.14); // fallback
  // The jacket vertical scan is the right border. Detect its colored vertical extent with local saturation.
  const x=Math.round(jg.jacketRight), ys=[];for(let y=0;y<p.bottom;y++){let mx=0;for(let dx=-4;dx<=4;dx++)mx=Math.max(mx,saturation(getRGB(data,w,clamp(x+dx,0,w-1),y)));ys.push(mx)}
  const ss=smooth(ys,4);let runs=[],st=null;for(let i=0;i<ss.length;i++){const on=ss[i]>65;if(on&&st===null)st=i;if(st!==null&&(!on||i===ss.length-1)){const e=!on?i:i+1;if(e-st>40)runs.push({t:st,b:e,w:e-st,score:mean(ss.slice(st,e))});st=null}}
  const jr=runs.filter(r=>r.t<p.bottom*.5).sort((a,b)=>b.score-a.score)[0]||{t:jTop,b:Math.round(p.bottom*.86),w:Math.round(p.bottom*.72)};
  const jacketTop2=jr.t,jacketBottom2=jr.b,jacketHeight=jacketBottom2-jacketTop2,jacketMid=Math.round((jacketTop2+jacketBottom2)/2),jacketThreeQ=Math.round(jacketTop2+jacketHeight*.75);
  const regions={
    A:{x:jg.jacketRight,y:jacketTop2,w:p.right-jg.jacketRight,h:jacketMid-jacketTop2},
    B:{x:dl.difficultyLeft,y:jacketMid,w:dl.difficultyRight-dl.difficultyLeft,h:jacketBottom2-jacketMid},
    C:{x:dl.levelLeft,y:jacketMid,w:dl.levelRight-dl.levelLeft,h:jacketBottom2-jacketMid},
    D:{x:boxes.goodLeft,y:rows.perfectTop,w:boxes.goodRight-boxes.goodLeft,h:rows.perfectBottom-rows.perfectTop},
    E:{x:boxes.goodLeft,y:rows.perfectBottom,w:boxes.goodRight-boxes.goodLeft,h:rows.goodTop-rows.perfectBottom},
    F:{x:boxes.goodLeft,y:rows.goodTop,w:boxes.goodRight-boxes.goodLeft,h:rows.goodBottom-rows.goodTop},
    G:{x:boxes.goodLeft,y:rows.goodBottom,w:boxes.goodRight-boxes.goodLeft,h:rows.missTop-rows.goodBottom},
    H:{x:boxes.goodLeft,y:rows.missTop,w:boxes.goodRight-boxes.goodLeft,h:rows.missBottom-rows.missTop},
    I:{x:boxes.lateFastLeft,y:rows.perfectTop,w:jg.gaugeLeft-boxes.lateFastLeft,h:rows.perfectBottom-rows.perfectTop}
  };
  return {panel:p,jacket:{left:jg.jacketLeft,right:jg.jacketRight,top:jacketTop2,bottom:jacketBottom2,height:jacketHeight,center:jacketMid,threeQuarter:jacketThreeQ},gauge:{left:jg.gaugeLeft,right:jg.gaugeRight},difficulty:{left:dl.difficultyLeft,right:dl.difficultyRight},level:{left:dl.levelLeft,right:dl.levelRight},rows,boxes,regions,scans:{panelBottomX:Math.round(w/2),panelXRange:[header.left,header.right],headerY:Math.round(p.bottom*.52),diffYs:dl.scanYs,rowsX:x,goodY:y},confidence:{panel:p.confidence,jacket:jg.confidence,gauge:jg.confidence.gauge}}
}

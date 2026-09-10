import {clamp,median,rgbToLuma,getImageData} from './image.js';

function lineStats(img,orientation,pos,half=2){
  const {width:w,height:h,data}=img; const n=orientation==='h'?w:h; const vals=[];
  for(let i=0;i<n;i++){let rs=0,gs=0,bs=0,c=0; for(let d=-half;d<=half;d++){let x=orientation==='h'?i:pos+d, y=orientation==='h'?pos+d:i; if(x<0||y<0||x>=w||y>=h)continue;const k=(y*w+x)*4;rs+=data[k];gs+=data[k+1];bs+=data[k+2];c++}const r=rs/c,g=gs/c,b=bs/c; vals.push({r,g,b,l:rgbToLuma(r,g,b),s:(Math.max(r,g,b)-Math.min(r,g,b))/(Math.max(1,Math.max(r,g,b)))});}return vals;
}

function edgeProfile(vals){const out=new Array(vals.length).fill(0);for(let i=1;i<vals.length;i++){const a=vals[i-1],b=vals[i];out[i]=Math.hypot(b.r-a.r,b.g-a.g,b.b-a.b)+Math.abs(b.l-a.l)*.55+Math.abs(b.s-a.s)*40}return out;}
function topCandidates(profile,start,end,dir=1){const arr=[];for(let i=Math.max(1,start);i<Math.min(profile.length-1,end);i++)arr.push({i,v:profile[i]});arr.sort((a,b)=>b.v-a.v);const picked=[];for(const c of arr){if(picked.every(p=>Math.abs(p.i-c.i)>8))picked.push(c);if(picked.length>=12)break}if(dir<0)picked.sort((a,b)=>b.i-a.i);return picked;}
function clusterMedian(cands,tol=12){const groups=[];for(const c of cands.sort((a,b)=>a-b)){let g=groups[groups.length-1];if(!g||Math.abs(c-g[g.length-1])>tol)groups.push([c]);else g.push(c)}const sizes=groups.map(g=>g.length);const best=groups.reduce((bi,g,i)=>g.length>groups[bi].length?i:bi,0);return groups.length?median(groups[best]):NaN;}
function strongestRange(profile,start,end,scoreFn=x=>x){let best={i:start,v:-Infinity};for(let i=start;i<=end;i++){const s=scoreFn(profile[i],i);if(s>best.v)best={i,v:s}}return best}

export function detectLayout(canvas){
  const img=getImageData(canvas),w=img.width,h=img.height, debug={scans:[],candidates:{}};
  const p=(x,y)=>{const i=(y*w+x)*4;return [img.data[i],img.data[i+1],img.data[i+2]]};
  const colorDist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

  // 1: vertical center scan. The header/background boundary is a long, stable edge.
  const cx=Math.round(w/2), s1=lineStats(img,'v',cx,Math.max(1,Math.round(w*.0015))), ep1=edgeProfile(s1);
  debug.scans.push({name:'1_center_vertical',orientation:'v',pos:cx,values:s1.map(v=>v.l),profile:ep1});
  const c1=[];for(let y=Math.round(h*.05);y<Math.round(h*.25);y++)if(ep1[y]>25)c1.push({i:y,v:ep1[y]});
  c1.sort((a,b)=>b.v-a.v); const panelBottom=(c1[0]?.i??Math.round(h*.13));
  const bottom=clamp(panelBottom,Math.round(h*.07),Math.round(h*.22)); debug.candidates.step1=c1.slice(0,20);

  // 2: find the long, pale header panel on several top rows. Using the center panel color
  // avoids false edges caused by the background illustrations and camera icon.
  const ref=p(cx,Math.min(8,h-1)); const ys2=[1,2,3,4,5,6].map(v=>clamp(v,0,h-1));
  const agg2=new Array(w).fill(0), inPanel=new Array(w).fill(0);
  for(const y of ys2){for(let x=0;x<w;x++){const d=colorDist(p(x,y),ref);const ok=d<38;agg2[x]+=d;inPanel[x]+=ok?1:0}}
  debug.scans.push({name:'2_top_horizontal',orientation:'h',pos:ys2,values:agg2.map(v=>v/ys2.length),profile:edgeProfile(agg2.map(v=>({r:v,g:v,b:v,l:v,s:0})))});
  function findRunAroundCenter(mask,minRun=20){let l=cx,r=cx;while(l>0&&mask[l-1])l--;while(r<w-1&&mask[r+1])r++;return r-l+1>=minRun?[l,r]:null}
  let fr=findRunAroundCenter(inPanel.map(v=>v>=Math.ceil(ys2.length*.5)),50); if(!fr)fr=[Math.round(w*.09),Math.round(w*.81)];
  let frameLeft=fr[0],frameRight=fr[1]; debug.candidates.step2={panelReference:ref,run:fr};

  // 3: jacket and gauge are detected from a row near the header center. The jacket is the
  // densest non-panel rectangular block in the left half; the gauge is a sustained cyan/green run.
  const y3=clamp(Math.round(bottom*.5),1,bottom-1), s3=lineStats(img,'h',y3,Math.max(1,Math.round(w*.001)));const ep3=edgeProfile(s3);
  debug.scans.push({name:'3_header_mid_horizontal',orientation:'h',pos:y3,values:s3.map(v=>v.l),profile:ep3});
  const panel=ref;const colScore=new Array(w).fill(0);const yStart=Math.max(2,Math.round(bottom*.08)),yEnd=Math.min(h-1,Math.round(bottom*.98));
  for(let x=frameLeft;x<=Math.min(frameRight,Math.round(frameLeft+(frameRight-frameLeft)*.42));x++){let hit=0,n=0;for(let y=yStart;y<yEnd;y+=2){const q=p(x,y);if(colorDist(q,panel)>42)hit++;n++}colScore[x]=hit/Math.max(1,n)}
  const targetW=Math.max(40,Math.round((frameRight-frameLeft)*.10));let bestJ={x:frameLeft,score:-1};
  for(let x=frameLeft+5;x<frameLeft+(frameRight-frameLeft)*.35-targetW;x+=2){let sum=0;for(let k=0;k<targetW;k+=2)sum+=colScore[x+k]||0;const sc=sum/(targetW/2);if(sc>bestJ.score)bestJ={x,score:sc}}
  let jacketLeft=bestJ.x,jacketRight=Math.min(frameRight-2,jacketLeft+targetW);
  // Refine edges around the best window using local contrast; keep a minimum width for stability.
  const refine=(seed,dir)=>{let x=seed,best=seed,bv=-1;for(let i=0;i<Math.round(targetW*.25);i++){const xx=clamp(seed+dir*i,frameLeft+2,frameRight-2);const v=ep3[xx];if(v>bv){bv=v;best=xx}}return best};
  jacketLeft=refine(jacketLeft,+1); jacketRight=refine(jacketRight,-1); if(jacketRight-jacketLeft<targetW*.6){jacketLeft=bestJ.x;jacketRight=bestJ.x+targetW}
  let gaugeLeft=NaN; for(let x=Math.max(jacketRight+20,Math.round(frameLeft+(frameRight-frameLeft)*.45));x<frameRight-20;x++){let good=0;for(let k=0;k<50&&x+k<w;k++){const v=s3[x+k];if(v.g>150&&v.b>150&&v.r<160&&v.g>v.r*1.25)good++}if(good>=35){gaugeLeft=x;break}}
  if(!Number.isFinite(gaugeLeft)){for(let x=Math.max(jacketRight+20,Math.round(frameLeft+(frameRight-frameLeft)*.45));x<frameRight;x++){const v=s3[x];if(v.s>.25&&v.g>v.r*1.15){gaugeLeft=x;break}}}
  if(!Number.isFinite(gaugeLeft))gaugeLeft=Math.round(frameLeft+(frameRight-frameLeft)*.56);
  debug.candidates.step3={jacketWindow:[jacketLeft,jacketRight],gaugeLeft};

  // 4: jacket vertical bounds. Score each y by departure from the pale header color,
  // then choose the top/bottom edges nearest the expected jacket band.
  const x4=Math.round((jacketLeft+jacketRight)/2),s4=lineStats(img,'v',x4,Math.max(1,Math.round(w*.001)));const ep4=edgeProfile(s4);debug.scans.push({name:'4_jacket_vertical',orientation:'v',pos:x4,values:s4.map(v=>v.l),profile:ep4});
  const candidates4=topCandidates(ep4,0,Math.max(1,bottom));debug.candidates.step4=candidates4;
  let jacketTop=findBestEdge(ep4,Math.round(bottom*.03),Math.round(bottom*.45),true);let jacketBottom=findBestEdge(ep4,Math.round(bottom*.45),Math.round(bottom*.99),true);
  if(!Number.isFinite(jacketTop))jacketTop=Math.round(bottom*.1);if(!Number.isFinite(jacketBottom))jacketBottom=Math.round(bottom*.88);if(jacketBottom<=jacketTop+30){jacketTop=Math.round(bottom*.1);jacketBottom=Math.round(bottom*.9)}

  // 5: at two internal y positions, classify the colored difficulty capsule and the dark level capsule.
  const ys5=[Math.round((jacketTop+jacketBottom)/2),Math.round(jacketTop+(jacketBottom-jacketTop)*.75)].map(y=>clamp(y,jacketTop+1,jacketBottom-1));
  const s5=ys5.map(y=>lineStats(img,'h',y,1)); const p5=s5[0].map((_,i)=>median(s5.map(ss=>ss[i].l)));
  const ep5=edgeProfile(p5.map(l=>({r:l,g:l,b:l,l,s:0})));debug.scans.push({name:'5_difficulty_level_horizontal',orientation:'h',pos:ys5,values:p5,profile:ep5});
  const colorAt=(x)=>s5.map(ss=>ss[x]);
  const magRun=findColorRun(s5[0],jacketRight+5,gaugeLeft-5,v=>v.r>135&&v.b>170&&v.r>v.g*1.05,12);
  const darkRun=findColorRun(s5[0],(magRun?.x2??jacketRight)+3,gaugeLeft-5,v=>v.l<105,25);
  let difficulty={left:magRun?.x1,right:magRun?.x2}, level={left:darkRun?.x1,right:darkRun?.x2};
  if(!difficulty.left){difficulty.left=Math.round(jacketRight+(gaugeLeft-jacketRight)*.05);difficulty.right=Math.round(difficulty.left+(gaugeLeft-jacketRight)*.20)}
  if(!level.left){level.left=difficulty.right+1;level.right=Math.round(level.left+(gaugeLeft-level.left)*.45)}
  if(level.right>=gaugeLeft){level.right=gaugeLeft-8}
  debug.candidates.step5={difficultyRun:magRun,darkRun:darkRun};

  // 9: scan vertically near the jacket-right x. To resist a stroke falling between individual
  // pixels, take the maximum luma across a very small x-neighborhood, then detect five text bands.
  const xs9=[jacketRight-3,jacketRight-1,jacketRight,jacketRight+1,jacketRight+3].map(x=>clamp(Math.round(x),0,w-1));
  const v9=xs9.map(x=>lineStats(img,'v',x,1));
  const start9=Math.round(bottom+h*.32), end9=Math.min(h-5,Math.round(bottom+h*.80));
  const values9=new Array(h).fill(0);for(let y=start9;y<=end9;y++){values9[y]=Math.max(...v9.map(ss=>ss[y]?.l||0))}
  const prof9=new Array(h).fill(0);for(let y=start9+1;y<=end9;y++)prof9[y]=Math.abs(values9[y]-values9[y-1]);
  debug.scans.push({name:'9_result_rows_vertical',orientation:'v',pos:xs9,values:values9,profile:prof9});
  // Bright text runs on the dark result background are much more stable than raw single-pixel edges.
  const bands9=[];let rs9=null;const base9=median(values9.slice(start9,end9+1).filter(v=>v>0));const thresh9=Math.max(85,base9+25);
  for(let y=start9;y<=end9;y++){const on=values9[y]>thresh9;if(on&&rs9===null)rs9=y;if(!on&&rs9!==null){if(y-rs9>=6)bands9.push({top:rs9,bottom:y-1,height:y-rs9});rs9=null}}
  if(rs9!==null&&end9+1-rs9>=6)bands9.push({top:rs9,bottom:end9,height:end9+1-rs9});
  // Merge nearby fragments, then keep the five rows that follow the vertical order in the UI.
  const merged9=[];for(const b of bands9){const prev=merged9[merged9.length-1];if(prev&&b.top-prev.bottom<=6){prev.bottom=b.bottom;prev.height=prev.bottom-prev.top+1}else merged9.push({...b})}
  debug.candidates.step9={threshold:thresh9,bands:merged9,rawPeaks:pickSeparatedPeaks(prof9,start9,end9,16,6,8)};
  let five=merged9.filter(b=>b.height>=12).slice(0,5);
  // The normal result layout contains exactly five value rows. A regular fallback is used only when a row is not visible enough.
  const approxStep=Math.max(45,Math.round(h*.055));
  if(five.length<5){const seed=merged9[0]?.top??Math.round(bottom+h*.42);five=Array.from({length:5},(_,i)=>({top:Math.round(seed+i*approxStep),bottom:Math.round(seed+i*approxStep+Math.max(16,Math.round(approxStep*.45)))}))}
  five=five.sort((a,b)=>a.top-b.top).slice(0,5);
  const perfect={top:five[0].top,bottom:five[0].bottom},great={top:five[1].top,bottom:five[1].bottom},good={top:five[2].top,bottom:five[2].bottom},bad={top:five[3].top,bottom:five[3].bottom},miss={top:five[4].top,bottom:five[4].bottom};

  // 10: horizontal scan at GOOD center. Aggregate adjacent rows to tolerate anti-aliasing, then detect
  // the long rounded score box followed by the separate LATE/FAST panel.
  const y10=Math.round((good.top+good.bottom)/2),s10=lineStats(img,'h',y10,2),ep10=edgeProfile(s10);debug.scans.push({name:'10_good_row_horizontal',orientation:'h',pos:y10,values:s10.map(v=>v.l),profile:ep10});
  const windowX1=frameLeft+5,windowX2=gaugeLeft-5;const baseline10=median(s10.slice(windowX1,Math.min(windowX2,w-1)).map(v=>v.l));
  const mask10=s10.map(v=>v.l>baseline10+7);const runs10=[];let rs10=null;for(let x=windowX1;x<=windowX2;x++){if(mask10[x]&&rs10===null)rs10=x;if((!mask10[x]||x===windowX2)&&rs10!==null){const e=mask10[x]?x:x-1;if(e-rs10>=25)runs10.push({x1:rs10,x2:e,length:e-rs10+1});rs10=null}}
  const scoreRun=runs10.sort((a,b)=>b.length-a.length)[0];let scoreLeft=scoreRun?.x1??Math.round(frameLeft+(frameRight-frameLeft)*.03),scoreRight=scoreRun?.x2??Math.round(jacketRight+(gaugeLeft-jacketRight)*.35);
  // Find the first strong edge after the score box.
  const nextPeaks=topCandidates(ep10,scoreRight+12,Math.max(scoreRight+13,gaugeLeft-1)).filter(c=>c.v>10);let lateFastLeft=nextPeaks[0]?.i??Math.round(scoreRight+(gaugeLeft-scoreRight)*.12);
  debug.candidates.step10={scoreRuns:runs10,scoreRun,lateFastCandidates:nextPeaks};

  const layout={frame:{left:Math.round(frameLeft),right:Math.round(frameRight),bottom:Math.round(bottom),width:Math.round(frameRight-frameLeft),height:Math.round(bottom)},jacket:{left:Math.round(jacketLeft),right:Math.round(jacketRight),top:Math.round(jacketTop),bottom:Math.round(jacketBottom),width:Math.round(jacketRight-jacketLeft),height:Math.round(jacketBottom-jacketTop)},gauge:{left:Math.round(gaugeLeft)},difficulty:{left:Math.round(difficulty.left),right:Math.round(difficulty.right)},level:{left:Math.round(level.left),right:Math.round(level.right)},rows:{perfect, great, good, bad, miss},score:{left:Math.round(scoreLeft),right:Math.round(scoreRight)},lateFast:{left:Math.round(lateFastLeft)}};
  layout.regions=makeRegions(layout,w,h);return {layout,debug};
}

function findBestEdge(profile,start,end){let best={i:NaN,v:-Infinity};for(let i=start;i<=end&&i<profile.length;i++){if(profile[i]>best.v)best={i,v:profile[i]}}return best.i}
function findColorRun(vals,start,end,pred,minLen){let on=false,s=0,best=null;for(let x=Math.max(0,start);x<=Math.min(vals.length-1,end);x++){const yes=pred(vals[x]);if(yes&&!on){s=x;on=true}else if(!yes&&on){if(x-s>=minLen&&(!best||x-s>best.x2-best.x1))best={x1:s,x2:x-1,length:x-s};on=false}}if(on&&end+1-s>=minLen){const x2=Math.min(vals.length-1,end);if(!best||x2-s>best.x2-best.x1)best={x1:s,x2,length:x2-s}}return best}
function pickSeparatedPeaks(profile,start,end,count,separation,minValue){const arr=[];for(let i=Math.max(1,start);i<Math.min(profile.length-1,end);i++)if(profile[i]>=minValue)arr.push({i,v:profile[i]});arr.sort((a,b)=>b.v-a.v);const pick=[];for(const c of arr){if(pick.every(p=>Math.abs(p.i-c.i)>=separation))pick.push(c);if(pick.length>=count)break}return pick.sort((a,b)=>a.i-b.i)}

function makeRegions(l,w,h){const clampRect=(x1,y1,x2,y2)=>({x1:clamp(Math.min(x1,x2),0,w-1),y1:clamp(Math.min(y1,y2),0,h-1),x2:clamp(Math.max(x1,x2),1,w),y2:clamp(Math.max(y1,y2),1,h)});
  const r={}; r.A=clampRect(l.jacket.right,l.jacket.top,l.frame.right,l.jacket.bottom>l.jacket.top?l.jacket.top+l.jacket.height*.5:l.frame.bottom*.5);
  r.A=clampRect(l.jacket.right,l.jacket.top,l.frame.right,l.jacket.top+(l.jacket.height*.5));
  r.B=clampRect(l.jacket.left,l.jacket.top+l.jacket.height*.5,l.difficulty.right,l.jacket.bottom); // adjusted below
  r.B=clampRect(l.jacket.left,l.jacket.top+l.jacket.height*.5,l.difficulty.right,l.jacket.bottom);
  r.C=clampRect(l.difficulty.right,l.jacket.top+l.jacket.height*.5,l.level.right,l.jacket.bottom);
  r.D=clampRect(l.score.left,l.rows.perfect.top,l.score.right,l.rows.perfect.bottom);
  r.E=clampRect(l.score.left,l.rows.perfect.bottom,l.score.right,l.rows.great.bottom);
  r.F=clampRect(l.score.left,l.rows.good.top,l.score.right,l.rows.good.bottom);
  r.G=clampRect(l.score.left,l.rows.bad.top,l.score.right,l.rows.bad.bottom);
  r.H=clampRect(l.score.left,l.rows.miss.top,l.score.right,l.rows.miss.bottom);
  r.I=clampRect(l.lateFast.left,l.frame.bottom,l.gauge.left,l.rows.perfect.bottom);
  // Correct region A/B/C vertical definitions to the specified screenshot semantics.
  r.A=clampRect(l.jacket.right,l.jacket.top,l.frame.right,l.jacket.top+l.jacket.height*.5);
  r.B=clampRect(l.jacket.left,l.jacket.top+l.jacket.height*.5,l.difficulty.right,l.jacket.bottom);
  r.C=clampRect(l.difficulty.right,l.jacket.top+l.jacket.height*.5,l.level.right,l.jacket.bottom);
  return r;
}

function findRowBands(img,x,y1,y2){const scan=lineStats(img,'v',clamp(Math.round(x),0,img.width-1),2);const bands=[];let on=false,s=0;for(let y=y1;y<=y2;y++){const v=scan[y];const signal=v && (v.s>.12 || v.l>125); if(signal&&!on){on=true;s=y}else if(!signal&&on){if(y-s>=4)bands.push({y1:s,y2:y-1,h:y-s,witness:1});on=false}}if(on)bands.push({y1:s,y2:y2,h:y2-s,witness:1});return bands}
function findHorizontalRuns(img,y,x1,x2){const scan=lineStats(img,'h',clamp(Math.round(y),0,img.height-1),2);const runs=[];let on=false,s=0;for(let x=x1;x<=x2;x++){const v=scan[x];const signal=v&&(v.s>.13||v.l>135);if(signal&&!on){on=true;s=x}else if(!signal&&on){if(x-s>=8)runs.push({x1:s,x2:x-1,w:x-s});on=false}}if(on)runs.push({x1:s,x2:x2,w:x2-s});return runs}

export function drawOverlay(srcCanvas,layout,show=true){const c=document.createElement('canvas');c.width=srcCanvas.width;c.height=srcCanvas.height;const ctx=c.getContext('2d');ctx.drawImage(srcCanvas,0,0);if(!show)return c;const L=layout;const line=(x1,y1,x2,y2,color,width=4)=>{ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.restore()};
  line(L.frame.left,0,L.frame.left,L.rows.miss.bottom+10,'#1688ff',7);line(L.frame.right,0,L.frame.right,L.rows.miss.bottom+10,'#1688ff',7);line(0,L.frame.bottom,srcCanvas.width,L.frame.bottom,'#ff3347',7);
  line(L.jacket.left,L.frame.bottom>0?L.jacket.top:0,L.jacket.left,L.jacket.bottom,'#35dc70',7);line(L.jacket.right,L.jacket.top,L.jacket.right,L.rows.miss.bottom,'#35dc70',7);line(L.gauge.left,L.jacket.top,L.gauge.left,L.jacket.bottom,'#35dc70',7);
  line(L.jacket.left,L.jacket.top,L.jacket.right,L.jacket.top,'#ffbd2e',4);line(L.jacket.left,L.jacket.bottom,L.jacket.right,L.jacket.bottom,'#ffbd2e',4);
  line(L.difficulty.left,L.jacket.top+L.jacket.height*.5,L.difficulty.left,L.jacket.bottom,'#b43cff',4);line(L.difficulty.right,L.jacket.top+L.jacket.height*.5,L.difficulty.right,L.jacket.bottom,'#b43cff',4);line(L.level.left,L.jacket.top+L.jacket.height*.5,L.level.left,L.jacket.bottom,'#b43cff',4);line(L.level.right,L.jacket.top+L.jacket.height*.5,L.level.right,L.jacket.bottom,'#b43cff',4);
  for(const [k,r] of Object.entries(L.rows)){line(L.score.left,r.top,L.gauge.left,r.top,'#ff2b72',5);line(L.score.left,r.bottom,L.gauge.left,r.bottom,'#ff2b72',5)}
  line(L.score.left,L.rows.perfect.top,L.score.left,L.rows.miss.bottom,'#34d5f3',7);line(L.score.right,L.rows.perfect.top,L.score.right,L.rows.miss.bottom,'#34d5f3',7);line(L.lateFast.left,L.rows.perfect.top,L.lateFast.left,L.rows.perfect.bottom,'#34d5f3',5);
  const labels=[['A',L.regions.A,'#ff8f2d'],['B',L.regions.B,'#ff8f2d'],['C',L.regions.C,'#ff8f2d'],['D',L.regions.D,'#fff'],['E',L.regions.E,'#fff'],['F',L.regions.F,'#fff'],['G',L.regions.G,'#fff'],['H',L.regions.H,'#fff'],['I',L.regions.I,'#fff']];for(const [k,r,col] of labels){ctx.fillStyle=col;ctx.font='bold 24px sans-serif';ctx.fillText(k,r.x1+6,r.y1+28)} return c}

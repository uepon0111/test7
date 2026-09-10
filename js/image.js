export function loadImage(file){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file);
    const img=new Image();
    img.onload=()=>{URL.revokeObjectURL(url);resolve(img)};
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('画像を読み込めませんでした。'))};
    img.src=url;
  });
}

export function imageToCanvas(img){
  const c=document.createElement('canvas'); c.width=img.naturalWidth||img.width; c.height=img.naturalHeight||img.height;
  c.getContext('2d',{willReadFrequently:true}).drawImage(img,0,0,c.width,c.height); return c;
}

export function getImageData(canvas){return canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height)}

export function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
export function median(a){const b=a.filter(Number.isFinite).slice().sort((x,y)=>x-y);if(!b.length)return NaN;return b[Math.floor(b.length/2)]}
export function quantile(a,q){const b=a.filter(Number.isFinite).slice().sort((x,y)=>x-y);if(!b.length)return NaN;const p=(b.length-1)*q,i=Math.floor(p),f=p-i;return b[i]+(b[i+1]-b[i]||0)*f}
export function rgbToLuma(r,g,b){return .2126*r+.7152*g+.0722*b}
export function samplePixel(data,x,y){x=Math.max(0,Math.min(data.width-1,Math.round(x)));y=Math.max(0,Math.min(data.height-1,Math.round(y)));const i=(y*data.width+x)*4;return [data.data[i],data.data[i+1],data.data[i+2]]}
export function cropCanvas(src,x,y,w,h){x=Math.max(0,Math.round(x));y=Math.max(0,Math.round(y));w=Math.max(1,Math.min(src.width-x,Math.round(w)));h=Math.max(1,Math.min(src.height-y,Math.round(h)));const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(src,x,y,w,h,0,0,w,h);return c}

export function preprocessRegion(canvas, mode='auto'){
  const src=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height);
  const out=document.createElement('canvas'); out.width=canvas.width; out.height=canvas.height; const ctx=out.getContext('2d');
  const gray=new Uint8ClampedArray(canvas.width*canvas.height); let mean=0;
  for(let i=0,p=0;i<src.data.length;i+=4,p++){const y=rgbToLuma(src.data[i],src.data[i+1],src.data[i+2]);gray[p]=y;mean+=y}
  mean/=gray.length;
  let invert=mode==='invert';
  if(mode==='auto'){ let border=0; for(let x=0;x<canvas.width;x++){border+=gray[x];border+=gray[(canvas.height-1)*canvas.width+x]} for(let y=1;y<canvas.height-1;y++){border+=gray[y*canvas.width];border+=gray[y*canvas.width+canvas.width-1]} border/=2*canvas.width+2*canvas.height-4; invert=border<mean; }
  // 3x3 box blur then local/global threshold depending on region size.
  const blur=new Float32Array(gray.length); const w=canvas.width,h=canvas.height;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){let s=0,n=0;for(let dy=-1;dy<=1;dy++){const yy=y+dy;if(yy<0||yy>=h)continue;for(let dx=-1;dx<=1;dx++){const xx=x+dx;if(xx<0||xx>=w)continue;s+=gray[yy*w+xx];n++}}blur[y*w+x]=s/n}
  const block=Math.max(8,Math.min(31,Math.round(Math.min(w,h)/6)*2+1)), r=Math.floor(block/2), outData=ctx.createImageData(w,h);
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      // approximate local threshold using a cross/limited window for stability.
      let sum=0,n=0;for(let yy=Math.max(0,y-r);yy<=Math.min(h-1,y+r);yy+=2)for(let xx=Math.max(0,x-r);xx<=Math.min(w-1,x+r);xx+=2){sum+=blur[yy*w+xx];n++}
      const t=sum/n-8; let v=blur[y*w+x]>t?255:0; if(invert)v=255-v; const p=(y*w+x)*4;outData.data[p]=outData.data[p+1]=outData.data[p+2]=v;outData.data[p+3]=255;
    }
  }
  ctx.putImageData(outData,0,0); return {canvas:out,invert,mean,borderMean:mean};
}

export function upscaleBinary(canvas,scale=2){const c=document.createElement('canvas');c.width=canvas.width*scale;c.height=canvas.height*scale;c.getContext('2d').drawImage(canvas,0,0,c.width,c.height);return c}

import {cropCanvas,preprocess} from "./image.js";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function normalizeText(s){return (s||"").replace(/\s+/g," ").trim()}
function digits(s){const m=(s||"").replace(/[OQoIlL]/g,"0").match(/\d+/g);return m?m.join(""):""}
function chooseNumeric(text){const ds=digits(text);if(!ds)return "";const chunks=(text||"").match(/\d{1,5}/g)||[];return chunks.sort((a,b)=>b.length-a.length)[0]||ds}
function imageForOCR(canvas,kind){
  const common={scale:2};
  if(kind==="title")return [preprocess(canvas,{...common,mode:"otsu",invert:false}),preprocess(canvas,{...common,mode:"otsu",invert:true})];
  return [preprocess(canvas,{...common,mode:"otsu",invert:false}),preprocess(canvas,{...common,mode:"adaptive",invert:false}),preprocess(canvas,{...common,mode:"otsu",invert:true})];
}
async function recognizeBest(worker,images,kind,log){
  let best={text:"",confidence:-1,variant:-1};
  for(let i=0;i<images.length;i++){
    try{
      const {data}=await worker.recognize(images[i]);
      const text=normalizeText(data.text);
      const conf=Number(data.confidence||0);
      log.push({variant:i,text,confidence:conf});
      let score=conf;
      if(kind==="title" && text.length<2)score-=30;
      if(kind!=="title" && !/\d/.test(text))score-=50;
      if(score>best.confidence)best={text,confidence:score,variant:i};
    }catch(e){log.push({variant:i,error:String(e)})}
  }return best;
}
export async function runOCR(sourceCanvas,geometry,onProgress){
  if(!window.Tesseract)throw new Error("Tesseract.jsを読み込めませんでした。インターネット接続とCDNへのアクセスを確認してください。");
  const worker=await Tesseract.createWorker("jpn+eng",1,{logger:m=>onProgress?.(m)});
  const results={}, logs=[];
  try{
    const specs={A:"title",B:"text",C:"number",D:"number",E:"number",F:"number",G:"number",H:"number",I:"number"};
    for(const key of Object.keys(geometry.regions)){
      const r=geometry.regions[key];
      const c=cropCanvas(sourceCanvas,r.x,r.y,r.w,r.h);
      const variants=imageForOCR(c,specs[key]);
      const log=[];const best=await recognizeBest(worker,variants,specs[key],log);
      results[key]={raw:best.text,confidence:best.confidence,variant:best.variant,images:variants,source:c,log};
      logs.push({region:key,best,attempts:log});
      onProgress?.({status:"recognizing",region:key});
    }
  }finally{await worker.terminate()}
  const out={
    title:results.A?.raw||"",
    difficulty:normalizeText(results.B?.raw||"").replace(/[^A-Za-zぁ-んァ-ヶ一-龥ー\s]/g,"").trim(),
    level:chooseNumeric(results.C?.raw||""),
    perfect:chooseNumeric(results.D?.raw||""),
    great:chooseNumeric(results.E?.raw||""),
    good:chooseNumeric(results.F?.raw||""),
    bad:chooseNumeric(results.G?.raw||""),
    miss:chooseNumeric(results.H?.raw||""),
    combo:chooseNumeric(results.I?.raw||"")
  };
  return {out,results,logs};
}

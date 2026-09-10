export function drawOverlay(canvas,geometry){
  const ctx=canvas.getContext("2d");ctx.clearRect(0,0,canvas.width,canvas.height);
  const g=geometry, W=canvas.width,H=canvas.height;
  const line=(x1,y1,x2,y2,color,width=5)=>{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke()};
  const colors={red:"#f33",blue:"#1685f4",green:"#43d66d",yellow:"#ffd32e",purple:"#b83fff",pink:"#f04b9b",cyan:"#39cbe9"};
  // Fine scan lines (the thick lines below are the final detected positions).
  line(g.scans.panelBottomX,0,g.scans.panelBottomX,H,colors.red,1);
  line(g.panel.left,g.scans.headerY,g.panel.right,g.scans.headerY,colors.blue,1);
  line(g.panel.left,g.scans.headerY,g.panel.right,g.scans.headerY,colors.green,1);
  line(g.jacket.right,g.jacket.top,g.jacket.right,g.jacket.bottom,colors.yellow,1);
  for(const y of g.scans.diffYs)line(g.jacket.right,y,g.gauge.left,y,colors.purple,1);
  line(g.boxes.scanX,g.panel.bottom,g.boxes.scanX,g.rows.missBottom,colors.pink,1);
  line(g.panel.left,g.scans.goodY,g.gauge.left,g.scans.goodY,colors.cyan,1);
  line(g.panel.left,g.panel.bottom,g.panel.right,g.panel.bottom,colors.red,5);
  line(g.panel.left,g.panel.top,g.panel.left,H,colors.blue,5);line(g.panel.right,g.panel.top,g.panel.right,H,colors.blue,5);
  line(g.jacket.right,g.panel.top,g.jacket.right,H,colors.green,5);line(g.gauge.left,g.panel.top,g.gauge.left,H,colors.green,5);
  line(g.jacket.left,g.jacket.top,g.jacket.right,g.jacket.top,colors.yellow,5);line(g.jacket.left,g.jacket.bottom,g.jacket.right,g.jacket.bottom,colors.yellow,5);line(g.jacket.right,g.jacket.center,g.panel.right,g.jacket.center,colors.yellow,4);
  line(g.difficulty.left,g.jacket.center,g.difficulty.left,g.jacket.bottom,colors.purple,4);line(g.difficulty.right,g.jacket.center,g.difficulty.right,g.jacket.bottom,colors.purple,4);
  line(g.level.left,g.jacket.center,g.level.left,g.jacket.bottom,colors.purple,4);line(g.level.right,g.jacket.center,g.level.right,g.jacket.bottom,colors.purple,4);
  for(const y of [g.rows.perfectTop,g.rows.perfectBottom,g.rows.goodTop,g.rows.goodBottom,g.rows.missTop,g.rows.missBottom])line(g.boxes.goodLeft,y,g.boxes.goodRight,y,colors.pink,4);
  line(g.boxes.goodLeft,g.rows.perfectTop,g.boxes.goodLeft,g.rows.missBottom,colors.cyan,4);line(g.boxes.goodRight,g.rows.perfectTop,g.boxes.goodRight,g.rows.missBottom,colors.cyan,4);line(g.boxes.lateFastLeft,g.rows.perfectTop,g.boxes.lateFastLeft,g.rows.perfectBottom,colors.cyan,4);
  const labels={A:"A",B:"B",C:"C",D:"D",E:"E",F:"F",G:"G",H:"H",I:"I"};ctx.font="bold 22px system-ui";ctx.textBaseline="top";
  for(const [k,r] of Object.entries(g.regions)){ctx.fillStyle="#fff";ctx.strokeStyle="#000";ctx.lineWidth=4;ctx.strokeText(labels[k],r.x+4,r.y+4);ctx.fillText(labels[k],r.x+4,r.y+4)}
}
export function geometryText(g){
  const o={panel:g.panel,jacket:g.jacket,gauge:g.gauge,difficulty:g.difficulty,level:g.level,rows:g.rows,boxes:g.boxes,scans:g.scans,regions:g.regions,confidence:g.confidence};return JSON.stringify(o,null,2)
}
export function makeProfileText(canvas,g){
  return [
    "【設計上のスキャン位置】",
    `赤: x=${g.scans.panelBottomX} / 白枠下端=${g.panel.bottom}`,
    `青: y=${g.scans.headerY} / 白枠 x=${g.panel.left}〜${g.panel.right}`,
    `緑: y=${g.scans.headerY} / ジャケット右=${g.jacket.right} / ゲージ左=${g.gauge.left}`,
    `黄: x=${g.jacket.right} / 上=${g.jacket.top} / 下=${g.jacket.bottom}`,
    `紫: y=${g.scans.diffYs.join(", ")} / 難易度=${g.difficulty.left}〜${g.difficulty.right} / Lv=${g.level.left}〜${g.level.right}`,
    `桃: x=${g.boxes.scanX} / P=${g.rows.perfectTop}〜${g.rows.perfectBottom}, G=${g.rows.goodTop}〜${g.rows.goodBottom}, M=${g.rows.missTop}〜${g.rows.missBottom}`,
    `水色: y=${g.scans.goodY} / 判定欄=${g.boxes.goodLeft}〜${g.boxes.goodRight} / LATE/FAST左=${g.boxes.lateFastLeft}`,
    "",
    "【信頼度】",
    JSON.stringify(g.confidence,null,2)
  ].join("\n")
}

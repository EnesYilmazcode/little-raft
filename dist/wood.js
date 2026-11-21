// A small original procedural timber texture, shared by every plank material.
// Weathered look: slightly desaturated base, darker worn long edges (u=0 and u=1), grime blotches,
// sun-bleached grain streaks, matte finish.
export function createWoodMaterial(T, color) {
 const canvas=document.createElement('canvas');canvas.width=128;canvas.height=512;
 const ctx=canvas.getContext('2d');
 const base=new T.Color(color),hsl={};base.getHSL(hsl);base.setHSL(hsl.h,hsl.s*.82,hsl.l);
 ctx.fillStyle='#'+base.getHexString();ctx.fillRect(0,0,128,512);
 let seed=1947;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 for(let k=0;k<7;k++){ // grime blotches
  const x=random()*128,y=random()*512,r=8+random()*22,g=ctx.createRadialGradient(x,y,0,x,y,r);
  g.addColorStop(0,'rgba(40,35,25,.12)');g.addColorStop(1,'rgba(40,35,25,0)');
  ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(x,y,r*.7,r*1.8,0,0,Math.PI*2);ctx.fill();
 }
 for(let i=0;i<100;i++){
  const x=random()*128,y=random()*512,length=30+random()*430;
  ctx.strokeStyle=i%3===0?'rgba(230,225,205,.18)':'rgba(56,40,24,.13)';ctx.lineWidth=.35+random()*1.5;
  ctx.beginPath();ctx.moveTo(x,y);ctx.bezierCurveTo(x+random()*6-3,y+length*.3,x+random()*9-4,y+length*.7,x+random()*5-2,y+length);ctx.stroke();
 }
 for(let k=0;k<3;k++){
  let x=20+random()*88,y=40+random()*430;
  for(let r=1;r<6;r++){ctx.beginPath();ctx.ellipse(x,y,r*1.4,r*4.7,.1,0,Math.PI*2);ctx.strokeStyle=`rgba(60,42,24,${.18-r*.02})`;ctx.lineWidth=.7;ctx.stroke();}
 }
 for(const [x0,x1] of [[0,5],[128,123]]){ // worn, darker long edges
  const g=ctx.createLinearGradient(x0,0,x1,0);g.addColorStop(0,'rgba(38,30,20,.42)');g.addColorStop(1,'rgba(38,30,20,0)');
  ctx.fillStyle=g;ctx.fillRect(Math.min(x0,x1),0,5,512);
 }
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=2;
 return new T.MeshStandardMaterial({map:texture,roughness:.95,metalness:0});
}

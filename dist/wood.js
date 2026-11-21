// A small original procedural timber texture. One grain canvas, painted once in the reference timber colour, is
// shared by every timber material; each material tints it by colour / reference, so a texture plus bump map is
// uploaded once instead of once per colour. (For the reference colour this matches the old per-colour canvas exactly.)
const REF = '#bb8a53';
const shared = new WeakMap(); // T -> texture

function grainTexture(T) {
 if (shared.has(T)) return shared.get(T);
 const canvas=document.createElement('canvas');canvas.width=128;canvas.height=512;
 const ctx=canvas.getContext('2d');ctx.fillStyle=REF;ctx.fillRect(0,0,128,512);
 let seed=1947;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<100;i++){
  const x=random()*128,y=random()*512,length=30+random()*430;
  ctx.strokeStyle=i%3===0?'rgba(255,235,187,.2)':'rgba(64,37,18,.13)';ctx.lineWidth=.35+random()*1.5;
  ctx.beginPath();ctx.moveTo(x,y);ctx.bezierCurveTo(x+random()*6-3,y+length*.3,x+random()*9-4,y+length*.7,x+random()*5-2,y+length);ctx.stroke();
 }
 for(let k=0;k<3;k++){
  let x=20+random()*88,y=40+random()*430;
  for(let r=1;r<6;r++){ctx.beginPath();ctx.ellipse(x,y,r*1.4,r*4.7,.1,0,Math.PI*2);ctx.strokeStyle=`rgba(68,37,19,${.18-r*.02})`;ctx.lineWidth=.7;ctx.stroke();}
 }
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;
 shared.set(T,texture);return texture;
}

export function createWoodMaterial(T, color) {
 const texture=grainTexture(T), ref=new T.Color(REF), tint=new T.Color(color);
 tint.setRGB(tint.r/ref.r,tint.g/ref.g,tint.b/ref.b,T.LinearSRGBColorSpace); // material colour multiplies the map in linear space
 return new T.MeshStandardMaterial({color:tint,map:texture,bumpMap:texture,bumpScale:.018,roughness:.86,metalness:0});
}

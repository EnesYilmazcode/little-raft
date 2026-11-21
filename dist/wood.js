// A small original procedural timber texture, shared by every plank material.
export function createWoodMaterial(T, color) {
 const canvas=document.createElement('canvas');canvas.width=128;canvas.height=512;
 const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,128,512);
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
 // The bump reads the same canvas through an isotropic twin (anisotropy is invisible at this bump scale but
 // costly on software GL), and with one tap instead of three: the height slope comes from screen derivatives.
 const bump=texture.clone();bump.anisotropy=1;
 const m=new T.MeshStandardMaterial({map:texture,bumpMap:bump,bumpScale:.018,roughness:.86,metalness:0});
 const chunk=oneTapBump(T);
 if(chunk){m.onBeforeCompile=sh=>{sh.fragmentShader=sh.fragmentShader.replace('#include <bumpmap_pars_fragment>',chunk);};m.customProgramCacheKey=()=>'lr-wood-bump1';}
 return m;
}
// three's bump chunk with the two offset taps replaced by dFdx/dFdy of the centre tap; null if the chunk changed shape.
let bumpChunk;
function oneTapBump(T){
 if(bumpChunk!==undefined)return bumpChunk;
 const src=T.ShaderChunk?.bumpmap_pars_fragment||'',x=/float dBx = [^;]*;/,y=/float dBy = [^;]*;/;
 return bumpChunk=x.test(src)&&y.test(src)?src.replace(x,'float dBx = dFdx( Hll );').replace(y,'float dBy = dFdy( Hll );'):null;
}

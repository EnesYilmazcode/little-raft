// A small original procedural timber texture, shared by every plank material.
// Look: weathered, sun-bleached driftwood. Broad soft mottling, faint grain, matte.

// The deck keys (listed in game.js TIMBER) are drawn with a bleached olive-tan driftwood palette.
const WEATHERED = {
 '#bb8a53':'#9c8a5e', '#c69860':'#a6956e', '#ad7c4a':'#8e7f57', // deck planks
 '#5e4029':'#5b4e38', '#9c7649':'#9a8b64', // deck logs and log ends
};

// Other timber keeps its hue but is pulled toward grey-olive and slightly lightened (sun bleach).
function bleach(hex) {
 const n=parseInt(hex.slice(1),16);let r=n>>16&255,g=n>>8&255,b=n&255;
 const l=.3*r+.59*g+.11*b;
 r=r*.72+l*.28;g=g*.72+l*.28+4;b=b*.72+l*.28;
 const f=v=>Math.max(0,Math.min(255,Math.round(v*1.02))).toString(16).padStart(2,'0');
 return '#'+f(r)+f(g)+f(b);
}

export function createWoodMaterial(T, color) {
 const base=WEATHERED[color]??bleach(color);
 const W=128,H=512;
 const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
 const ctx=canvas.getContext('2d');ctx.fillStyle=base;ctx.fillRect(0,0,W,H);
 let seed=1947;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 // Broad weathering blotches: stains, grime and paler sun-bleached patches, elongated along the grain.
 for(let i=0;i<46;i++){
  const x=random()*W,y=random()*H,rx=10+random()*34,ry=30+random()*110,dark=random()<.55;
  const g=ctx.createRadialGradient(0,0,0,0,0,1);
  const c=dark?'56,44,26':'208,202,180',a=dark?.07+random()*.09:.05+random()*.07;
  g.addColorStop(0,`rgba(${c},${a})`);g.addColorStop(1,`rgba(${c},0)`);
  ctx.save();ctx.translate(x,y);ctx.scale(rx,ry);ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,1,0,Math.PI*2);ctx.fill();ctx.restore();
 }
 // Grime toward the board ends.
 for(const [y0,y1] of [[0,70],[H,H-70]]){const g=ctx.createLinearGradient(0,y0,0,y1);g.addColorStop(0,'rgba(50,42,26,.16)');g.addColorStop(1,'rgba(50,42,26,0)');ctx.fillStyle=g;ctx.fillRect(0,Math.min(y0,y1),W,70);}
 // Faint long grain.
 for(let i=0;i<70;i++){
  const x=random()*W,y=random()*H,length=60+random()*420;
  ctx.strokeStyle=i%3===0?'rgba(236,230,200,.08)':'rgba(48,40,24,.08)';ctx.lineWidth=.5+random()*1.8;
  ctx.beginPath();ctx.moveTo(x,y);ctx.bezierCurveTo(x+random()*6-3,y+length*.3,x+random()*9-4,y+length*.7,x+random()*5-2,y+length);ctx.stroke();
 }
 // A couple of soft knots.
 for(let k=0;k<2;k++){
  const x=24+random()*80,y=60+random()*390;
  for(let r=1;r<5;r++){ctx.beginPath();ctx.ellipse(x,y,r*1.6,r*5,.1,0,Math.PI*2);ctx.strokeStyle=`rgba(56,46,28,${.1-r*.015})`;ctx.lineWidth=.9;ctx.stroke();}
 }
 // Grey-green bleach wash over everything, then darker worn board edges.
 ctx.fillStyle='rgba(146,146,128,.08)';ctx.fillRect(0,0,W,H);
 for(const [x0,x1] of [[0,16],[W,W-16]]){const g=ctx.createLinearGradient(x0,0,x1,0);g.addColorStop(0,'rgba(44,38,24,.2)');g.addColorStop(1,'rgba(44,38,24,0)');ctx.fillStyle=g;ctx.fillRect(Math.min(x0,x1),0,16,H);}
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;
 // The bump term samples its map three times per pixel; anisotropic filtering there is invisible at this bump
 // scale but costly on software GL, so the bump reads the same canvas through an isotropic twin.
 const bump=texture.clone();bump.anisotropy=1;
 return new T.MeshStandardMaterial({map:texture,bumpMap:bump,bumpScale:.009,roughness:.95,metalness:0}); // driftwood look, isotropic bump twin for perf
}

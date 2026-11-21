// A small original procedural timber texture, shared by every plank material.
// Look: weathered, sun-bleached driftwood. Broad soft mottling, faint grain, grimy scuffed ends, matte.

// Raft timber palette (deck boards, logs, log ends); already weathered, drawn as given.
export const DRIFTWOOD = Object.freeze({plank:'#9c8a5e', plankLight:'#a6956e', plankDark:'#8e7f57', log:'#5b4e38', logEnd:'#9a8b64'});
const AS_IS = new Set(Object.values(DRIFTWOOD));

// Older warm timber colours keep their hue but are pulled toward grey-olive and slightly lightened (sun bleach).
function bleach(hex) {
 const n=parseInt(hex.slice(1),16);let r=n>>16&255,g=n>>8&255,b=n&255;
 const l=.3*r+.59*g+.11*b;
 r=r*.72+l*.28;g=g*.72+l*.28+4;b=b*.72+l*.28;
 const f=v=>Math.max(0,Math.min(255,Math.round(v*1.02))).toString(16).padStart(2,'0');
 return '#'+f(r)+f(g)+f(b);
}

export function createWoodMaterial(T, color) {
 const base=AS_IS.has(color)?color:bleach(color);
 const W=128,H=512;
 const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
 const ctx=canvas.getContext('2d');ctx.fillStyle=base;ctx.fillRect(0,0,W,H);
 let seed=1947;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 // Broad weathering blotches: stains, grime and paler sun-bleached patches, elongated along the grain.
 for(let i=0;i<46;i++){
  const x=random()*W,y=random()*H,rx=10+random()*34,ry=30+random()*110,dark=random()<.55;
  const g=ctx.createRadialGradient(0,0,0,0,0,1);
  const c=dark?'56,44,26':'208,202,180',a=dark?.08+random()*.1:.05+random()*.07;
  g.addColorStop(0,`rgba(${c},${a})`);g.addColorStop(1,`rgba(${c},0)`);
  ctx.save();ctx.translate(x,y);ctx.scale(rx,ry);ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,1,0,Math.PI*2);ctx.fill();ctx.restore();
 }
 // Grime soaked into the board ends (the ends sit in the wet and get trodden on).
 for(const [y0,y1] of [[0,96],[H,H-96]]){const g=ctx.createLinearGradient(0,y0,0,y1);g.addColorStop(0,'rgba(40,32,18,.34)');g.addColorStop(.35,'rgba(44,36,22,.14)');g.addColorStop(1,'rgba(44,36,22,0)');ctx.fillStyle=g;ctx.fillRect(0,Math.min(y0,y1),W,96);}
 // Faint long grain.
 for(let i=0;i<70;i++){
  const x=random()*W,y=random()*H,length=60+random()*420;
  ctx.strokeStyle=i%3===0?'rgba(236,230,200,.08)':'rgba(48,40,24,.09)';ctx.lineWidth=.5+random()*1.8;
  ctx.beginPath();ctx.moveTo(x,y);ctx.bezierCurveTo(x+random()*6-3,y+length*.3,x+random()*9-4,y+length*.7,x+random()*5-2,y+length);ctx.stroke();
 }
 // Scuffs: short dark smears and scratches, mostly near the ends.
 for(let i=0;i<34;i++){
  const end=random()<.7,y=end?(random()<.5?random()*110:H-random()*110):random()*H,x=random()*W;
  ctx.strokeStyle=`rgba(38,30,18,${.1+random()*.14})`;ctx.lineWidth=.6+random()*2.4;ctx.lineCap='round';
  const a=(random()-.5)*1.4,l=4+random()*16;
  ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.sin(a)*l,y+Math.cos(a)*l*1.6);ctx.stroke();
 }
 // A couple of soft knots.
 for(let k=0;k<2;k++){
  const x=24+random()*80,y=60+random()*390;
  for(let r=1;r<5;r++){ctx.beginPath();ctx.ellipse(x,y,r*1.6,r*5,.1,0,Math.PI*2);ctx.strokeStyle=`rgba(56,46,28,${.1-r*.015})`;ctx.lineWidth=.9;ctx.stroke();}
 }
 // Grey-green bleach wash over everything, then darker worn board edges.
 ctx.fillStyle='rgba(146,146,128,.07)';ctx.fillRect(0,0,W,H);
 for(const [x0,x1] of [[0,18],[W,W-18]]){const g=ctx.createLinearGradient(x0,0,x1,0);g.addColorStop(0,'rgba(40,34,20,.26)');g.addColorStop(1,'rgba(40,34,20,0)');ctx.fillStyle=g;ctx.fillRect(Math.min(x0,x1),0,18,H);}
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;
 return new T.MeshStandardMaterial({map:texture,bumpMap:texture,bumpScale:.009,roughness:.95,metalness:0});
}

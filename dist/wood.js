// A small original procedural timber texture, shared by every plank material.
// Look: weathered, sun-bleached driftwood. Broad soft mottling, faint grain, grimy board ends and edges, matte.

// The deck keys (listed in game.js TIMBER) are drawn with a warm weathered-driftwood palette (warm grey-tan, not olive:
// the sky-blue hemisphere fill cools the deck, so the base sits a little redder than the on-screen target).
const WEATHERED = {
 '#bb8a53':'#a58c66', '#c69860':'#ae9775', '#ad7c4a':'#957d5b', // deck planks
 '#5e4029':'#5c4533', '#9c7649':'#a08766', // deck logs and log ends
};
const DECK = new Set(['#bb8a53', '#c69860', '#ad7c4a']); // deck boards: also get the log-line grime (deck.js v ~.13 / ~.87)

// Other timber keeps its hue but is pulled toward a warm grey (sun bleach), never toward green.
function bleach(hex) {
 const n=parseInt(hex.slice(1),16);let r=n>>16&255,g=n>>8&255,b=n&255;
 const l=.3*r+.59*g+.11*b;
 r=r*.74+l*.26+3;g=g*.74+l*.26;b=b*.74+l*.26-4;
 const f=v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0');
 return '#'+f(r)+f(g)+f(b);
}

export function createWoodMaterial(T, color) {
 const base=WEATHERED[color]??bleach(color);
 const W=128,H=512;
 const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
 const ctx=canvas.getContext('2d');ctx.fillStyle=base;ctx.fillRect(0,0,W,H);
 let seed=1947;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 // Broad weathering blotches: stains, grime and paler sun-bleached patches, elongated along the grain.
 for(let i=0;i<52;i++){
  const x=random()*W,y=random()*H,rx=10+random()*34,ry=30+random()*110,dark=random()<.55;
  const g=ctx.createRadialGradient(0,0,0,0,0,1);
  const c=dark?'58,38,22':'226,208,178',a=dark?.08+random()*.1:.05+random()*.08;
  g.addColorStop(0,`rgba(${c},${a})`);g.addColorStop(1,`rgba(${c},0)`);
  ctx.save();ctx.translate(x,y);ctx.scale(rx,ry);ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,1,0,Math.PI*2);ctx.fill();ctx.restore();
 }
 // Long grain: fine dark fibres, the odd pale sun-dried streak.
 for(let i=0;i<90;i++){
  const x=random()*W,y=random()*H,length=60+random()*420;
  ctx.strokeStyle=i%3===0?'rgba(240,224,196,.08)':'rgba(52,34,20,.11)';ctx.lineWidth=.5+random()*1.8;
  ctx.beginPath();ctx.moveTo(x,y);ctx.bezierCurveTo(x+random()*6-3,y+length*.3,x+random()*9-4,y+length*.7,x+random()*5-2,y+length);ctx.stroke();
 }
 // A few dark hairline checks (drying cracks) running with the grain.
 for(let i=0;i<7;i++){
  const x=8+random()*(W-16),y=random()*H,length=20+random()*90;
  ctx.strokeStyle='rgba(40,26,14,.28)';ctx.lineWidth=.7;
  ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(x+random()*4-2,y+length/2,x+random()*3-1.5,y+length);ctx.stroke();
 }
 // A couple of soft knots with a dark heart.
 for(let k=0;k<2;k++){
  const x=24+random()*80,y=60+random()*390;
  ctx.fillStyle='rgba(48,30,16,.22)';ctx.beginPath();ctx.ellipse(x,y,2.2,5,.1,0,Math.PI*2);ctx.fill();
  for(let r=1;r<5;r++){ctx.beginPath();ctx.ellipse(x,y,r*1.6,r*5,.1,0,Math.PI*2);ctx.strokeStyle=`rgba(56,36,20,${.13-r*.02})`;ctx.lineWidth=.9;ctx.stroke();}
 }
 // Deck boards: grime and rust bloom where the board sits on a log (nails and lashings), at v ~ .13 and ~ .87.
 if(DECK.has(color)) for(const v of [.133,.867]){
  const y=H*v,g=ctx.createLinearGradient(0,y-26,0,y+26);
  g.addColorStop(0,'rgba(54,34,18,0)');g.addColorStop(.5,'rgba(54,34,18,.16)');g.addColorStop(1,'rgba(54,34,18,0)');
  ctx.fillStyle=g;ctx.fillRect(0,y-26,W,52);
  for(const u of [.24,.3,.5,.7,.76]){
   const s=ctx.createRadialGradient(0,0,0,0,0,1);s.addColorStop(0,'rgba(70,36,14,.2)');s.addColorStop(1,'rgba(70,36,14,0)');
   ctx.save();ctx.translate(W*u,y);ctx.scale(9,16);ctx.fillStyle=s;ctx.beginPath();ctx.arc(0,0,1,0,Math.PI*2);ctx.fill();ctx.restore();
  }
 }
 // Warm sun-bleach wash over everything.
 ctx.fillStyle='rgba(176,156,124,.06)';ctx.fillRect(0,0,W,H);
 // Grime and wear toward the board ends (end grain soaks up dirt).
 for(const [y0,y1] of [[0,96],[H,H-96]]){const g=ctx.createLinearGradient(0,y0,0,y1);g.addColorStop(0,'rgba(46,30,16,.34)');g.addColorStop(.35,'rgba(50,34,18,.14)');g.addColorStop(1,'rgba(50,34,18,0)');ctx.fillStyle=g;ctx.fillRect(0,Math.min(y0,y1),W,96);}
 // Darker worn board edges: contact grime and shade where boards meet (deck uv u spans ~.04-.96).
 for(const [x0,x1] of [[0,22],[W,W-22]]){const g=ctx.createLinearGradient(x0,0,x1,0);g.addColorStop(0,'rgba(40,26,14,.5)');g.addColorStop(.3,'rgba(44,30,16,.24)');g.addColorStop(1,'rgba(44,30,16,0)');ctx.fillStyle=g;ctx.fillRect(Math.min(x0,x1),0,22,H);}
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;
 // No bumpMap: at bumpScale .018 it moved no pixel by more than 1/255 at spawn, looking down or along the deck, while
 // its three extra taps per pixel were the largest single cost of shading the deck (docs/tech/perf-ADOPT.md step 6).
 return new T.MeshStandardMaterial({map:texture,roughness:.92,metalness:0});
}

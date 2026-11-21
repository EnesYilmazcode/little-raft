from pathlib import Path
p=Path('dist/game.js');s=p.read_text(encoding='utf-8')
s=s.replace("const $ = s =>", "export function mount(transfer=null) {\nlet raf=0,paused=false,disposed=false;const abort=new AbortController(),emitters=[];\nfunction listen(target,type,fn,options={}){target?.addEventListener(type,fn,{...options,signal:abort.signal});}\nfunction trackOn(target,type,fn){target.on(type,fn);emitters.push([target,type,fn]);return target;}\nconst $ = s =>",1)
s=s.replace("renderer = new T.WebGLRenderer({canvas, antialias:true});", "renderer = transfer?.renderer || new T.WebGLRenderer({canvas, antialias:true});")
s=s.replace("for (let i = 0; i < 30; i++) world.items.push(makeItem(i));", "if(!world.items.length)for (let i = 0; i < 30; i++) world.items.push(makeItem(i));")
s=s.replace("setTool('hook'); animate();", "setTool(tool); animate();")
s=s.replace('requestAnimationFrame(animate);','if(paused||disposed)return;raf=requestAnimationFrame(animate);')
s=s.replace('document.addEventListener(', 'listen(document,').replace('canvas.addEventListener(', 'listen(canvas,').replace("$('#resumeHint')?.addEventListener(","listen($('#resumeHint'),")
s=s.replace('\naddEventListener(', '\nlisten(window,')
s=s.replace('peer.on(', 'trackOn(peer,').replace('c.on(', 'trackOn(c,')
s=s.replace("document.body.classList.toggle('first-person', running);", "document.body.classList.toggle('first-person', running);document.body.classList.toggle('playing',running);document.body.classList.toggle('locked',locked);")
start=s.index('try { init(); }')
restore='''if(transfer){world=transfer.world;me={...transfer.me};other=transfer.other;yaw=transfer.yaw;pitch=transfer.pitch;running=transfer.running;tool=transfer.tool;recipe=transfer.recipe;elapsed=transfer.elapsed;hook=transfer.hook;fishWait=transfer.fishWait;sound=transfer.sound;audio=transfer.audio;peer=transfer.peer;conn=transfer.conn;role=transfer.role;networkReady=transfer.networkReady;room=transfer.room;ownWorldBackup=transfer.ownWorldBackup;}
'''
s=s[:start]+restore+s[start:]
s+='''\nreturn {
 capture(){return {world,me:{...me},other,yaw,pitch,running,tool,recipe,elapsed,hook,fishWait,sound,audio,peer,conn,role,networkReady,room,ownWorldBackup,pending,renderer};},
 pause(){paused=true;cancelAnimationFrame(raf);},
 resume(){if(disposed)return;paused=false;last=performance.now();animate();},
 dispose(){disposed=true;cancelAnimationFrame(raf);abort.abort();for(const [target,type,fn]of emitters)target.off(type,fn);clearTimeout(joinTimer);clearTimeout(toast.timer);scene.traverse(o=>{o.geometry?.dispose();const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){if(m){m.map?.dispose();m.dispose();}}});}
};
}
'''
p.write_text(s,encoding='utf-8')

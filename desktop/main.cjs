const {app,BrowserWindow,Menu}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const configPath=path.join(__dirname,'config.json');
const config=fs.existsSync(configPath)?JSON.parse(fs.readFileSync(configPath,'utf8')):{};
const origin=config.origin||'http://127.0.0.1:41896';
app.setName('Little Raft');
app.setPath('userData',path.join(app.getPath('appData'),'Little Raft'));
app.setAppUserModelId('local.littleraft.game');
let win,retry;
if(!app.requestSingleInstanceLock())app.quit();else{
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.whenReady().then(()=>{
 Menu.setApplicationMenu(null);
 win=new BrowserWindow({title:'Little Raft',width:1366,height:850,minWidth:900,minHeight:620,backgroundColor:'#0b2931',autoHideMenuBar:true,icon:path.join(__dirname,'little-raft.png'),webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(origin+'/')&&!url.startsWith('data:'))event.preventDefault();});
 win.webContents.session.setPermissionRequestHandler((wc,permission,callback)=>callback(permission==='pointerLock'||permission==='fullscreen'));
 win.webContents.session.setPermissionCheckHandler((wc,permission)=>permission==='pointerLock'||permission==='fullscreen');
 win.webContents.on('did-fail-load',(_e,code,_desc,url,isMain)=>{if(!isMain||code===-3)return;clearTimeout(retry);retry=setTimeout(()=>win&&!win.isDestroyed()&&win.loadURL(origin).catch(()=>{}),2500);});
 // Escape while a game panel (inventory, crafting, pause, crew, help) is open: swallow it here and close the panel
 // from main with userGesture=true, so the relock is allowed even after the user's own Escape. The page announces
 // panel state with a console sentinel (no preload needed; contextIsolation stays on) and main also re-queries it.
 const wc=win.webContents;let panelOpen=false,swallowEsc=false;
 const refreshPanel=()=>{if(!win||win.isDestroyed())return;wc.executeJavaScript('!!(window.raftShell&&window.raftShell.panelOpen())').then(v=>{panelOpen=!!v;},()=>{});};
 const ESCAPE_JS='(window.raftShell?window.raftShell.escape(true):(()=>{const d=[...document.querySelectorAll("dialog[open]")].pop();if(d){d.close();return true;}return false;})())';
 wc.on('console-message',(e,level,message)=>{const m=typeof e?.message==='string'?e.message:message;if(typeof m==='string'&&m.startsWith('[raft-shell] panel='))panelOpen=m.endsWith('=true');});
 wc.on('before-input-event',(event,input)=>{
  if(input.key!=='Escape'){if(input.type==='keyUp')refreshPanel();return;}
  if(input.type==='keyDown'){
   if(!panelOpen&&!swallowEsc)return; // no panel: normal Escape (leave pointer lock, page opens the pause menu)
   event.preventDefault();
   if(swallowEsc||input.isAutoRepeat)return;
   swallowEsc=true;panelOpen=false;
   wc.executeJavaScript(ESCAPE_JS,true).then(refreshPanel,refreshPanel);
  }else if(input.type==='keyUp'&&swallowEsc){
   // Relock on release, with a gesture: relocking while Escape is still held would count as leaving the lock.
   event.preventDefault();swallowEsc=false;
   wc.executeJavaScript('window.raftShell&&window.raftShell.released()',true).then(refreshPanel,refreshPanel);
  }
 });
 // Focus never auto-locks; the next click in the page relocks with its own gesture.
 win.on('blur',()=>{swallowEsc=false;}); // the page drops its held-Escape state on blur too
 win.on('focus',refreshPanel);
 wc.on('did-start-navigation',(_e,_url,_inPlace,isMain)=>{if(isMain!==false)panelOpen=false;});
 win.on('closed',()=>{clearTimeout(retry);win=null;});
 win.loadURL(origin).catch(()=>{});
});
app.on('window-all-closed',()=>app.quit());
}

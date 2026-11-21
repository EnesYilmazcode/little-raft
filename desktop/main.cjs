const {app,BrowserWindow,Menu,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const configPath=path.join(__dirname,'config.json'),preloadPath=path.join(__dirname,'preload.cjs');
const config=fs.existsSync(configPath)?JSON.parse(fs.readFileSync(configPath,'utf8')):{};
const origin=config.origin||'http://127.0.0.1:41896';
app.setName('Little Raft');
app.setPath('userData',path.join(app.getPath('appData'),'Little Raft'));
app.setAppUserModelId('local.littleraft.game');
let win,retry,escClaimed=false; // escClaimed: the page routes Escape via window.raftEscape()
if(!app.requestSingleInstanceLock())app.quit();else{
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.whenReady().then(()=>{
 Menu.setApplicationMenu(null);
 win=new BrowserWindow({title:'Little Raft',width:1366,height:850,minWidth:900,minHeight:620,backgroundColor:'#0b2931',autoHideMenuBar:true,acceptFirstMouse:true,icon:path.join(__dirname,'little-raft.png'),webPreferences:{...(fs.existsSync(preloadPath)?{preload:preloadPath}:{}),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 ipcMain.on('raft:claim-escape',(e,on)=>{if(win&&e.sender===win.webContents)escClaimed=!!on;});
 win.webContents.on('did-start-navigation',d=>{if(d.isMainFrame&&!d.isSameDocument)escClaimed=false;}); // a reload must claim again
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(origin+'/')&&!url.startsWith('data:'))event.preventDefault();});
 win.webContents.session.setPermissionRequestHandler((wc,permission,callback)=>callback(permission==='pointerLock'||permission==='fullscreen'));
 win.webContents.session.setPermissionCheckHandler((wc,permission)=>permission==='pointerLock'||permission==='fullscreen');
 win.webContents.on('did-fail-load',(_e,code,_desc,url,isMain)=>{if(!isMain||code===-3)return;clearTimeout(retry);retry=setTimeout(()=>win&&!win.isDestroyed()&&win.loadURL(origin).catch(()=>{}),2500);});
 // Escape is handled in the page with userGesture=true (executeJavaScript(code, true)), so closing a menu
 // (inventory, crafting, pause, crew, help) can take the mouse back without a click and without flashing the cursor.
 // When the page claimed Escape (preload + settings.js), every Escape goes through window.raftEscape(). Without the
 // preload, only an Escape while a game panel is open is swallowed; the page announces panel state with a console
 // sentinel (contextIsolation stays on) and main also re-queries it. The relock waits for the key release.
 const wc=win.webContents;let panelOpen=false,swallowEsc=false;
 const refreshPanel=()=>{if(!win||win.isDestroyed())return;wc.executeJavaScript('!!(window.raftShell&&window.raftShell.panelOpen())').then(v=>{panelOpen=!!v;},()=>{});};
 const ESCAPE_JS='(window.raftShell?window.raftShell.escape(true):window.raftEscape?(window.raftEscape(),true):(()=>{const d=[...document.querySelectorAll("dialog[open]")].pop();if(d){d.close();return true;}return false;})())';
 wc.on('console-message',(e,level,message)=>{const m=typeof e?.message==='string'?e.message:message;
  if(typeof m!=='string')return;
  if(m.startsWith('[raft-shell] panel='))panelOpen=m.endsWith('=true');
  else if(m==='[raft-shell] relock')wc.executeJavaScript('window.raftShell&&window.raftShell.relock&&window.raftShell.relock()',true).catch(()=>{}); // page asks for a retry with a gesture
 });
 wc.on('before-input-event',(event,input)=>{
  if(input.key!=='Escape'){if(input.type==='keyUp'&&!escClaimed)refreshPanel();return;} // claimed: panelOpen is never read
  if(input.type==='keyDown'){
   if(!escClaimed&&!panelOpen&&!swallowEsc)return; // unclaimed, no panel: normal Escape (leave pointer lock, page opens the pause menu)
   event.preventDefault();
   if(swallowEsc||input.isAutoRepeat)return;
   swallowEsc=true;panelOpen=false;
   wc.executeJavaScript(ESCAPE_JS,true).then(refreshPanel,refreshPanel);
  }else if(input.type==='keyUp'&&swallowEsc){
   // Relock on release, with a gesture: relocking while Escape is still held would count as leaving the lock.
   event.preventDefault();swallowEsc=false;
   wc.executeJavaScript('window.raftShell&&window.raftShell.released()',true).then(refreshPanel,refreshPanel);
  }else if(input.type==='keyUp'){
   // Keyup without its keydown: the browser used that keydown to leave pointer lock (it runs before
   // before-input-event), so the page never saw the press. Open the pause menu instead of leaving a free cursor.
   if(escClaimed)event.preventDefault(); // claimed: the page never sees a native Escape
   wc.executeJavaScript('window.raftShell&&window.raftShell.escapedLock&&window.raftShell.escapedLock()',true).catch(()=>{});
  }
 });
 // Focus return (alt-tab back): relock with a gesture, but only if play was locked when focus left and no
 // menu is open (raftShell.focusRelock decides). The short delay lets the page see its own focus event first.
 win.on('blur',()=>{swallowEsc=false;}); // the page drops its held-Escape state on blur too
 win.on('focus',()=>{
  if(!escClaimed)refreshPanel();
  setTimeout(()=>{if(win&&!win.isDestroyed()&&win.isFocused())wc.executeJavaScript('window.raftShell&&window.raftShell.focusRelock&&window.raftShell.focusRelock()',true).catch(()=>{});},100);
 });
 wc.on('did-start-navigation',(_e,_url,_inPlace,isMain)=>{if(isMain!==false)panelOpen=false;});
 win.on('closed',()=>{clearTimeout(retry);win=null;});
 win.loadURL(origin).catch(()=>{});
});
app.on('window-all-closed',()=>app.quit());
}

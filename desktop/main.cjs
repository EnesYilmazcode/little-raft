const {app,BrowserWindow,Menu,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const configPath=path.join(__dirname,'config.json'),preloadPath=path.join(__dirname,'preload.cjs');
const config=fs.existsSync(configPath)?JSON.parse(fs.readFileSync(configPath,'utf8')):{};
const origin=config.origin||'http://127.0.0.1:41896';
app.setName('Little Raft');
app.setPath('userData',path.join(app.getPath('appData'),'Little Raft'));
app.setAppUserModelId('local.littleraft.game');
let win,retry,escClaimed=false,escDown=false; // escClaimed: the page routes Escape via window.raftEscape()
if(!app.requestSingleInstanceLock())app.quit();else{
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.whenReady().then(()=>{
 Menu.setApplicationMenu(null);
 win=new BrowserWindow({title:'Little Raft',width:1366,height:850,minWidth:900,minHeight:620,backgroundColor:'#0b2931',autoHideMenuBar:true,acceptFirstMouse:true,icon:path.join(__dirname,'little-raft.png'),webPreferences:{...(fs.existsSync(preloadPath)?{preload:preloadPath}:{}),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 ipcMain.on('raft:claim-escape',(e,on)=>{if(win&&e.sender===win.webContents)escClaimed=!!on;});
 win.webContents.on('did-start-navigation',d=>{if(d.isMainFrame&&!d.isSameDocument)escClaimed=false;}); // a reload must claim again
 // Escape never reaches the page while claimed: the page handles it with a user gesture, so closing a
 // menu (inventory, pause) can take the mouse back without a click and without flashing the cursor.
 win.webContents.on('before-input-event',(event,input)=>{
  if(!escClaimed||input.key!=='Escape'||(input.type!=='keyDown'&&input.type!=='keyUp'))return;
  event.preventDefault();
  const wc=win.webContents;
  if(input.type==='keyDown'){
   if(input.isAutoRepeat||escDown)return;
   escDown=true; // the page holds any relock until the key is released
   wc.executeJavaScript('window.raftShell&&window.raftShell.hold&&window.raftShell.hold();window.raftEscape&&window.raftEscape()',true).catch(()=>{});
  }else if(!escDown){
   // Chromium eats the keyDown that ends pointer lock, so only this keyUp arrives: treat it as the press (opens pause).
   wc.executeJavaScript('window.raftEscape&&window.raftEscape()',true).catch(()=>{});
  }else{
   // Relock on release, with a gesture: relocking while Escape is still held would count as leaving the lock.
   escDown=false;
   wc.executeJavaScript('window.raftShell&&window.raftShell.released&&window.raftShell.released()',true).catch(()=>{});
  }
 });
 win.on('blur',()=>{escDown=false;}); // the page drops its held-Escape state on blur too; the next click relocks
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(origin+'/')&&!url.startsWith('data:'))event.preventDefault();});
 win.webContents.session.setPermissionRequestHandler((wc,permission,callback)=>callback(permission==='pointerLock'||permission==='fullscreen'));
 win.webContents.session.setPermissionCheckHandler((wc,permission)=>permission==='pointerLock'||permission==='fullscreen');
 win.webContents.on('did-fail-load',(_e,code,_desc,url,isMain)=>{if(!isMain||code===-3)return;clearTimeout(retry);retry=setTimeout(()=>win&&!win.isDestroyed()&&win.loadURL(origin).catch(()=>{}),2500);});
 win.on('closed',()=>{clearTimeout(retry);win=null;});
 win.loadURL(origin).catch(()=>{});
});
app.on('window-all-closed',()=>app.quit());
}

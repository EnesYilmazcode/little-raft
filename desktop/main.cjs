const {app,BrowserWindow,Menu,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const configPath=path.join(__dirname,'config.json'),preloadPath=path.join(__dirname,'preload.cjs');
const config=fs.existsSync(configPath)?JSON.parse(fs.readFileSync(configPath,'utf8')):{};
const origin=config.origin||'http://127.0.0.1:41896';
app.setName('Little Raft');
app.setPath('userData',path.join(app.getPath('appData'),'Little Raft'));
app.setAppUserModelId('local.littleraft.game');
let win,retry,refocusTimer,escClaimed=false,escDown=false; // escClaimed: the page routes Escape via window.raftEscape()
if(!app.requestSingleInstanceLock())app.quit();else{
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.whenReady().then(()=>{
 Menu.setApplicationMenu(null);
 win=new BrowserWindow({title:'Little Raft',width:1366,height:850,minWidth:900,minHeight:620,backgroundColor:'#0b2931',autoHideMenuBar:true,icon:path.join(__dirname,'little-raft.png'),webPreferences:{...(fs.existsSync(preloadPath)?{preload:preloadPath}:{}),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
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
  }else if(escDown){
   // Relock on release, with a gesture: relocking while Escape is still held would count as leaving the lock.
   escDown=false;
   wc.executeJavaScript('window.raftShell&&window.raftShell.released&&window.raftShell.released()',true).catch(()=>{});
  }else{
   // A release with no press: during locked play Chromium spends the keyDown on leaving pointer lock before this
   // hook sees it. Run the Escape now, with a gesture: it pauses (cursor only with the menu up) or, with the
   // hammer's build wheel open, closes the wheel and takes the lock straight back.
   wc.executeJavaScript('window.raftEscape&&window.raftEscape()',true).catch(()=>{});
  }
 });
 win.on('blur',()=>{escDown=false;clearTimeout(refocusTimer);}); // the page drops its held-Escape state on blur too
 // Back from alt-tab: relock with a gesture when play was locked as focus left and no menu is up (the page decides).
 win.on('focus',()=>{clearTimeout(refocusTimer);refocusTimer=setTimeout(()=>{if(win&&!win.isDestroyed()&&win.isFocused())win.webContents.executeJavaScript('window.raftShell&&window.raftShell.refocus&&window.raftShell.refocus()',true).catch(()=>{});},120);});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(origin+'/')&&!url.startsWith('data:'))event.preventDefault();});
 win.webContents.session.setPermissionRequestHandler((wc,permission,callback)=>callback(permission==='pointerLock'||permission==='fullscreen'));
 win.webContents.session.setPermissionCheckHandler((wc,permission)=>permission==='pointerLock'||permission==='fullscreen');
 win.webContents.on('did-fail-load',(_e,code,_desc,url,isMain)=>{if(!isMain||code===-3)return;clearTimeout(retry);retry=setTimeout(()=>win&&!win.isDestroyed()&&win.loadURL(origin).catch(()=>{}),2500);});
 win.on('closed',()=>{clearTimeout(retry);clearTimeout(refocusTimer);win=null;});
 win.loadURL(origin).catch(()=>{});
});
app.on('window-all-closed',()=>app.quit());
}

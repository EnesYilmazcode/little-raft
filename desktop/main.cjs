const {app,BrowserWindow,Menu,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const configPath=path.join(__dirname,'config.json');
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
 win=new BrowserWindow({title:'Little Raft',width:1366,height:850,minWidth:900,minHeight:620,backgroundColor:'#0b2931',autoHideMenuBar:true,icon:path.join(__dirname,'little-raft.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 ipcMain.on('raft:claim-escape',(e,on)=>{if(win&&e.sender===win.webContents)escClaimed=!!on;});
 win.webContents.on('did-start-navigation',d=>{if(d.isMainFrame&&!d.isSameDocument)escClaimed=false;}); // a reload must claim again
 // Escape never reaches the page while claimed: the page handles it with a user gesture, so closing a
 // menu (inventory, pause) can take the mouse back without a click and without flashing the cursor.
 win.webContents.on('before-input-event',(event,input)=>{
  if(!escClaimed||input.key!=='Escape'||(input.type!=='keyDown'&&input.type!=='keyUp'))return;
  event.preventDefault();
  if(input.type==='keyDown'&&!input.isAutoRepeat)win.webContents.executeJavaScript('window.raftEscape&&window.raftEscape()',true).catch(()=>{});
 });
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

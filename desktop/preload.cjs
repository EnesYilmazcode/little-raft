// Tiny bridge: the page tells the main process it routes Escape itself (see dist/settings.js).
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('raftDesktop',{claimEscape:on=>ipcRenderer.send('raft:claim-escape',!!on)});

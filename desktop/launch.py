from pathlib import Path
import os,subprocess,sys,time,json,urllib.request,ctypes
ROOT=Path(__file__).resolve().parents[1]

def healthy():
 try:
  with urllib.request.urlopen('http://127.0.0.1:41896/health',timeout=1) as r:return json.load(r).get('app')=='little-raft'
 except Exception:return False

def main():
 if not healthy():
  with (ROOT/'desktop/server.log').open('ab') as log:
   server_env={**os.environ,'RAFT_RELEASE_MODE':'1'}
   subprocess.Popen([str(Path(sys.executable).with_name('python.exe')),str(ROOT/'desktop/server.py')],cwd=ROOT,stdin=subprocess.DEVNULL,stdout=log,stderr=log,env=server_env,creationflags=subprocess.CREATE_NO_WINDOW|subprocess.DETACHED_PROCESS,close_fds=True)
  for _ in range(40):
   if healthy():break
   time.sleep(.15)
  else:ctypes.windll.user32.MessageBoxW(0,'The ocean server could not start. Check desktop/server.log.','Little Raft',0x10);return
 watcher=ROOT/'release_queue.py'
 if watcher.is_file():
  (ROOT/'.releases').mkdir(exist_ok=True)
  with (ROOT/'.releases/watcher.log').open('ab') as log:
   subprocess.Popen([str(Path(sys.executable).with_name('python.exe')),str(watcher),'--watch'],cwd=ROOT,stdin=subprocess.DEVNULL,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW|subprocess.DETACHED_PROCESS,close_fds=True)
 electron=ROOT/'node_modules/electron/dist/electron.exe'
 subprocess.Popen([str(electron),str(ROOT)],cwd=ROOT,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW,close_fds=True)

if __name__=='__main__':main()

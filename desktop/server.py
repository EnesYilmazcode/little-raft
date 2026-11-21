"""Stable LAN origin and uncached live game assets. No access outside dist/."""
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit,parse_qs,unquote
import hashlib,json,mimetypes,re,sys
ROOT=Path(__file__).resolve().parents[1]/'dist'

def version():
 h=hashlib.sha256()
 for p in sorted(ROOT.iterdir()):
  if p.suffix in ('.js','.css','.svg','.html'):
   h.update(p.name.encode());h.update(p.read_bytes())
 return h.hexdigest()[:16]

class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  u=urlsplit(self.path)
  if u.path=='/health':return self.reply(json.dumps({'app':'little-raft','build':version()}).encode(),'application/json')
  if u.path=='/version.json':return self.reply(json.dumps({'build':version(),'protocol':1}).encode(),'application/json')
  p=(ROOT/unquote(u.path).lstrip('/')).resolve()
  if p==ROOT:p=ROOT/'index.html'
  if ROOT not in p.parents or not p.is_file():self.send_error(404);return
  raw=p.read_bytes()
  if p.suffix=='.js' and p.parent==ROOT:
   build=parse_qs(u.query).get('build',[version()])[0]
   if re.fullmatch(r'[A-Za-z0-9_-]{1,80}',build):
    text=raw.decode('utf-8')
    text=re.sub(r'''(['"])(\./(?:avatar|ocean|wood|hook|hook-physics)\.js)(?:\?[^'"]*)?\1''',lambda m:m[1]+m[2]+'?build='+build+m[1],text)
    raw=text.encode()
  mime=mimetypes.guess_type(str(p))[0] or 'application/octet-stream'
  if p.suffix=='.js':mime='text/javascript'
  self.reply(raw,mime)
 def reply(self,raw,mime):
  self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
 def log_message(self,*args):pass

if __name__=='__main__':
 try:ThreadingHTTPServer(('0.0.0.0',41896),Handler).serve_forever()
 except OSError as e:print(e,file=sys.stderr);sys.exit(1)

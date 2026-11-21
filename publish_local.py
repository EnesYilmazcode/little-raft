"""Promote a tested candidate; publish the manifest last for in-session updates."""
from pathlib import Path, PurePosixPath
import argparse,hashlib,json,os,posixpath,re,time

ROOT=Path(__file__).resolve().parent
# A relative module literal: './name.js' or './dir/name.js', optionally with a query already on it.
SPEC=re.compile(r"""(['"])\./((?:[a-z][a-z0-9-]*/)*[a-z][a-z0-9-]*\.js)(?:\?[^'"]*)?\1""")
# Static import/export-from only (dynamic import() targets are lazy and stay out of the startup graph).
STATIC=re.compile(r"""(?:^|[\s;}])(?:import|export)\s+(?:[^'"();]*?\s+from\s+|[^'"();]*?\bfrom\s*)?['"]\./((?:[a-z][a-z0-9-]*/)*[a-z][a-z0-9-]*\.js)(?:\?[^'"]*)?['"]""",re.M)
PRELOAD_LIST=re.compile(r"const PRELOAD = \[[\s\S]*?\];")
HTML_BLOCK=re.compile(r"<!-- startup-preload -->[\s\S]*?<!-- /startup-preload -->")

def _target(rel,name):
 """dist-relative posix path a literal in file `rel` points at; vendor/ is shared across builds and never stamped."""
 t=posixpath.normpath(posixpath.join(str(PurePosixPath(rel).parent),name))
 return None if t.startswith(('vendor/','../')) else t

def stamp(files,build):
 names={str(k).replace('\\','/') for k in files}
 for rel,data in list(files.items()):
  key=str(rel).replace('\\','/')
  if rel.suffix!='.js' or key.startswith('vendor/'):continue
  def spec(m):
   t=_target(key,m[2])
   return m[1]+'./'+m[2]+'?build='+build+m[1] if t in names else m[0]
  files[rel]=SPEC.sub(spec,data.decode('utf-8')).encode()

def _strip(src):
 src=re.sub(r"/\*[\s\S]*?\*/","",src)
 return re.sub(r"(^|[^:'\"`\\])//.*$",r"\1",src,flags=re.M)

def static_graph(files,entry='game.js'):
 """game.js' static import graph in breadth-first order (nearest imports first), entry excluded."""
 src={str(k).replace('\\','/'):v for k,v in files.items()}
 order,seen,queue=[],{entry},[entry]
 while queue:
  f=queue.pop(0)
  for m in STATIC.finditer(_strip(src[f].decode('utf-8'))):
   t=_target(f,m[1])
   if t and t in src and t not in seen:seen.add(t);order.append(t);queue.append(t)
 return order

def sync_preload(files,build):
 """Write game.js' static graph into live.js PRELOAD (injected at boot and on hot-swap) and into index.html as
 static <link rel=modulepreload> tags, so the fetches start while the HTML parses instead of after live.js runs."""
 graph=static_graph(files)
 live,html=Path('live.js'),Path('index.html')
 if live in files:
  items=sorted(graph);lines,cur=[],'  '
  for n in items:
   piece="'"+n+"',"
   if len(cur)+len(piece)+1>118:lines.append(cur.rstrip());cur='  '
   cur+=piece+' '
  lines.append(cur.rstrip())
  body='const PRELOAD = [\n'+'\n'.join(lines)+'\n];'
  text=files[live].decode('utf-8');assert PRELOAD_LIST.search(text),'live.js has no const PRELOAD = [...]'
  files[live]=PRELOAD_LIST.sub(lambda m:body,text,count=1).encode()
 if html in files:
  links=''.join('<link rel="modulepreload" href="'+n+'?build='+build+'">' for n in ['game.js']+graph)
  block='<!-- startup-preload -->'+links+'<!-- /startup-preload -->'
  text=files[html].decode('utf-8')
  if HTML_BLOCK.search(text):text=HTML_BLOCK.sub(lambda m:block,text,count=1)
  else:
   # Last in <body>, after the page's own scripts: CSS, live.js, prompts.js and onboarding.js are requested first
   # (they hold back DOMContentLoaded), then the module fan-out.
   assert text.count('</body>')==1,'index.html needs one </body>'
   text=text.replace('</body>',block+'</body>',1)
  files[html]=text.encode()

def promote(source, label='release'):
 source=Path(source).resolve()
 if not (source/'game.js').is_file():raise ValueError('Candidate game.js missing')
 files={p.relative_to(source):p.read_bytes() for p in source.rglob('*') if p.is_file()}
 digest=hashlib.sha256(b''.join(str(k).encode()+v for k,v in sorted(files.items()) if k.name!='version.json')).hexdigest()[:12]
 build=label+'-'+digest
 stamp(files,build)
 sync_preload(files,build)
 for rel,data in files.items():
  if rel.name=='version.json':continue
  dest=ROOT/'dist'/rel
  dest.parent.mkdir(parents=True,exist_ok=True)
  if dest.exists() and dest.read_bytes()==data:continue
  temp=dest.with_name(dest.name+'.release-tmp');temp.write_bytes(data);os.replace(temp,dest)
 manifest=ROOT/'dist/version.json';tmp=manifest.with_suffix('.tmp')
 tmp.write_text(json.dumps({'build':build,'protocol':1,'releasedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}),encoding='utf-8');os.replace(tmp,manifest)
 (ROOT/'desktop/last-release.json').write_text(json.dumps({'build':build,'source':str(source),'time':time.time()},indent=2),encoding='utf-8')
 print(json.dumps({'published':build,'files':len(files),'origin':'http://127.0.0.1:41896'}))
 return build

def resync(dist):
 """Re-stamp and re-sync preloads of a dist in place under its current version.json build (no new release)."""
 dist=Path(dist).resolve()
 build=json.loads((dist/'version.json').read_text(encoding='utf-8'))['build']
 files={p.relative_to(dist):p.read_bytes() for p in dist.rglob('*') if p.is_file() and not p.name.endswith('.release-tmp')}
 before=dict(files);stamp(files,build);sync_preload(files,build)
 changed=[str(k) for k in files if files[k]!=before[k]]
 for k in changed:(dist/k).write_bytes(files[Path(k)])
 print(json.dumps({'build':build,'changed':changed}))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('--label',default='release')
 p.add_argument('--resync',action='store_true',help='stamp imports and sync preloads of <source> in place, keeping its build')
 a=p.parse_args()
 resync(a.source) if a.resync else promote(a.source,a.label)

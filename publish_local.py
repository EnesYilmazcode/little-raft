"""Promote a tested candidate; publish the manifest last for in-session updates.
python publish_local.py <candidate>   promote a candidate folder into dist/
python publish_local.py --sync        re-stamp dist/ in place with its current build (after hand edits)"""
from pathlib import Path
import argparse,hashlib,json,os,re,time,posixpath

ROOT=Path(__file__).resolve().parent
SPEC=re.compile(r"""(['"])(\./[a-z][a-z0-9-]*\.js)(?:\?[^'"]*)?\1""")
# Static import/export-from and bare imports (dynamic import() stays lazy on purpose).
STATIC=re.compile(r"""(?:^|\n)\s*(?:import|export)\s[^;'"]*?from\s*['"](\.[^'"]+)['"]|(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]""")
PRELOAD_BLOCK=re.compile(r'<!-- modulepreload:start -->.*?<!-- modulepreload:end -->',re.S)

def stamp(text,build,names):
 """Pin every top-level './x.js' specifier to ?build=<build> so each module has exactly one URL (one instance)."""
 def spec(m):
  return m[1]+m[2]+'?build='+build+m[1] if m[2][2:] in names else m[0]
 return SPEC.sub(spec,text)

def module_graph(read,roots):
 """All module URLs (relative to dist, query kept) statically reachable from roots, in discovery order."""
 seen=[];todo=list(roots)
 while todo:
  url=todo.pop(0)
  if url in seen:continue
  seen.append(url)
  path,_,query=url.partition('?');base=posixpath.dirname(path)
  for a,b in STATIC.findall(read(path)):
   s=a or b;p,_,q=s.partition('?')
   todo.append(posixpath.normpath(posixpath.join(base,p))+('?'+q if q else ''))
 return seen

def graph_roots(html,live,build):
 roots=re.findall(r'<script type="module" src="([^"]+)"',html)
 game=re.search(r"""new URL\('\./(game\.js[^']*)'""",live)
 return roots+[game[1] if game else 'game.js?build='+build]

def preload_html(html,read,build):
 """Replace the generated <link rel=modulepreload> block with the whole static graph, so the browser
 fetches it in parallel instead of discovering it one import level at a time."""
 mods=module_graph(read,graph_roots(html,read('live.js'),build))
 block='<!-- modulepreload:start -->'+''.join(f'<link rel="modulepreload" href="{m}">' for m in mods)+'<!-- modulepreload:end -->'
 if PRELOAD_BLOCK.search(html):return PRELOAD_BLOCK.sub(lambda m:block,html)
 # Older candidates: replace their hand-written modulepreload tags with the block (or add it before </head>).
 first=re.search(r'<link rel="modulepreload"[^>]*>',html)
 html=re.sub(r'<link rel="modulepreload"[^>]*>','',html)
 at=first.start() if first else html.index('</head>')
 return html[:at]+block+html[at:]

def restamp(files,build):
 names={str(k).replace('\\','/') for k in files}
 for rel,data in list(files.items()):
  if rel.suffix=='.js' and rel.parent==Path('.'):
   files[rel]=stamp(data.decode('utf-8'),build,names).encode()
 index=Path('index.html')
 if index in files:
  read=lambda p:files[Path(p)].decode('utf-8')
  files[index]=preload_html(read('index.html'),read,build).encode()
 return files

def write_dist(files):
 for rel,data in files.items():
  if rel.name=='version.json':continue
  dest=ROOT/'dist'/rel
  dest.parent.mkdir(parents=True,exist_ok=True)
  if dest.exists() and dest.read_bytes()==data:continue
  temp=dest.with_name(dest.name+'.release-tmp');temp.write_bytes(data);os.replace(temp,dest)

def read_tree(source):
 return {p.relative_to(source):p.read_bytes() for p in source.rglob('*') if p.is_file() and not p.name.endswith('.release-tmp')}

def promote(source, label='release'):
 source=Path(source).resolve()
 if not (source/'game.js').is_file():raise ValueError('Candidate game.js missing')
 files=read_tree(source)
 digest=hashlib.sha256(b''.join(str(k).encode()+v for k,v in sorted(files.items()) if k.name!='version.json')).hexdigest()[:12]
 build=label+'-'+digest
 write_dist(restamp(files,build))
 manifest=ROOT/'dist/version.json';tmp=manifest.with_suffix('.tmp')
 tmp.write_text(json.dumps({'build':build,'protocol':1,'releasedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}),encoding='utf-8');os.replace(tmp,manifest)
 (ROOT/'desktop/last-release.json').write_text(json.dumps({'build':build,'source':str(source),'time':time.time()},indent=2),encoding='utf-8')
 print(json.dumps({'published':build,'files':len(files),'origin':'http://127.0.0.1:41896'}))
 return build

def sync():
 """Re-stamp dist/ with the build in dist/version.json (no new build, manifest untouched)."""
 build=json.loads((ROOT/'dist/version.json').read_text(encoding='utf-8'))['build']
 write_dist(restamp(read_tree(ROOT/'dist'),build))
 print(json.dumps({'synced':build}))
 return build

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source',nargs='?');p.add_argument('--label',default='release');p.add_argument('--sync',action='store_true');a=p.parse_args()
 if a.sync:sync()
 elif a.source:promote(a.source,a.label)
 else:p.error('source or --sync required')

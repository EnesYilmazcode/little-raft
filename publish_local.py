"""Promote a tested candidate; publish the manifest last for in-session updates."""
from pathlib import Path
import argparse,hashlib,json,os,re,time

ROOT=Path(__file__).resolve().parent
def promote(source, label='release'):
 source=Path(source).resolve()
 if not (source/'game.js').is_file():raise ValueError('Candidate game.js missing')
 files={p.relative_to(source):p.read_bytes() for p in source.rglob('*') if p.is_file()}
 hashes={str(k).replace('\\','/'):hashlib.sha256(v).hexdigest()[:12] for k,v in files.items()}
 for rel,data in list(files.items()):
  if rel.suffix=='.js' and rel.parent==Path('.'):
   text=data.decode('utf-8')
   def spec(m):
    name=m[2][2:]
    return m[1]+m[2]+'?build='+hashes[name]+m[1] if name in hashes else m[0]
   text=re.sub(r"""(['"])(\./[a-z][a-z0-9-]*\.js)(?:\?[^'"]*)?\1""",spec,text)
   files[rel]=text.encode()
 digest=hashlib.sha256(b''.join(str(k).encode()+v for k,v in sorted(files.items()) if k.name!='version.json')).hexdigest()[:12]
 build=label+'-'+digest
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
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('--label',default='release');a=p.parse_args();promote(a.source,a.label)

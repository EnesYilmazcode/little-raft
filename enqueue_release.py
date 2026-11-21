"""Snapshot a complete candidate and mark it ready for the automatic release queue."""
from pathlib import Path
import argparse, json, os, re, shutil

ROOT=Path(__file__).resolve().parent

def enqueue(source,release_id,label,checks):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}',release_id):
        raise ValueError('Invalid release id')
    if not checks:raise ValueError('Release checks are required')
    queue=ROOT/'.releases/queue';queue.mkdir(parents=True,exist_ok=True)
    target=queue/release_id
    if target.exists():raise FileExistsError(target)
    staging=queue/(release_id+'.preparing')
    staging.mkdir()
    shutil.copytree(Path(source).resolve(),staging/'dist')
    (staging/'candidate.json').write_text(json.dumps({'label':label,'checks':checks},indent=2),encoding='utf-8')
    os.replace(staging,target)
    (target/'candidate.ready').touch()
    print(json.dumps({'queued':release_id,'status':str(ROOT/'.releases/status'/f'{release_id}.json')}))
    return target

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('--id',required=True);p.add_argument('--label',required=True);p.add_argument('--checks-file',required=True)
    a=p.parse_args();enqueue(a.source,a.id,a.label,json.loads(Path(a.checks_file).read_text(encoding='utf-8')))

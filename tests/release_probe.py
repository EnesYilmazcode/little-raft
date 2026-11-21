"""Check the release gate uses an isolated, reachable candidate, optionally fail it."""
from pathlib import Path
import json, os, sys, urllib.request

candidate=Path(os.environ['RAFT_DIST']).resolve()
assert candidate != Path(__file__).resolve().parents[1]/'dist'
assert (candidate/'game.js').is_file()
url=os.environ['RAFT_QA_URL']
assert url.startswith('http://127.0.0.1:') and ':41896' not in url
with urllib.request.urlopen(url+'/health',timeout=5) as response:
    assert json.load(response)['app']=='little-raft'
if '--reject' in sys.argv:
    print('Intentional failing candidate: live release must stay unchanged.')
    sys.exit(17)
print('Isolated candidate server is reachable.')

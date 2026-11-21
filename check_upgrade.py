"""Roll two connected v2 clients into the candidate, without a manual refresh."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from release_queue import QAServer
import io, json, os, shutil, subprocess, tarfile, time, uuid

ROOT=Path(__file__).resolve().parent
CANDIDATE=Path(os.environ.get('RAFT_DIST',ROOT/'.qa/survival/dist')).resolve()
work=ROOT/'.qa'/('upgrade-'+uuid.uuid4().hex[:8]);dist=work/'dist'
dist.mkdir(parents=True)
archive=subprocess.check_output(['git','archive','5b5beb7','dist'],cwd=ROOT)
with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
    for member in tar.getmembers():
        if member.isfile():
            dest=(work/member.name).resolve()
            assert dist.resolve() in dest.parents
            dest.parent.mkdir(parents=True,exist_ok=True)
            dest.write_bytes(tar.extractfile(member).read())
(dist/'version.json').write_text(json.dumps({'build':'upgrade-baseline-v2','protocol':1}))
server=QAServer(ROOT,dist,41904,work)
def state(page):return page.evaluate('raftDebug.state')
def wait(page,expr,timeout=30000):page.wait_for_function(expr,timeout=timeout)
def seeded_context(browser,wood,extra):
    context=browser.new_context(viewport={'width':1440,'height':900})
    saved={'tiles':[[x,z] for z in [-1,0,1] for x in [-1,0,1]]+extra,'decor':[],
           'stock':{'wood':wood,'leaf':10,'scrap':2},'fish':3,'collected':4,'hookHealth':82}
    context.add_init_script('localStorage.setItem("little-raft-v1",'+json.dumps(json.dumps(saved))+');')
    context.add_init_script('HTMLCanvasElement.prototype.requestPointerLock=function(){return Promise.reject(new Error("QA fallback"))};')
    return context
try:
    server.start()
    with sync_playwright() as p:
        browser=p.chromium.launch(channel='chrome',headless=True)
        ca=seeded_context(browser,20,[[2,0]])
        cb=seeded_context(browser,8,[[0,2],[1,2]])
        host=ca.new_page();guest=cb.new_page();errors=[]
        for page in [host,guest]:
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(server.url);wait(page,'!!window.raftDebug')
        host.locator('#welcomeCrew').click();host.locator('#host').click()
        wait(host,'document.querySelector("#roomCode").textContent.length===6')
        code=host.locator('#roomCode').inner_text()
        guest.locator('#welcomeCrew').click();guest.locator('#roomInput').fill(code)
        guest.locator('#joinForm button').click()
        for page in [host,guest]:
            wait(page,'raftDebug.state.networkReady');page.mouse.click(720,450)
        assert state(host)['tiles']==state(guest)['tiles']==10
        # Snapshot dependencies first, and only advertise the new build once complete.
        for src in CANDIDATE.rglob('*'):
            if src.is_file() and src.name!='version.json':
                target=dist/src.relative_to(CANDIDATE);target.parent.mkdir(parents=True,exist_ok=True)
                shutil.copy2(src,target)
        (dist/'version.json').write_text(json.dumps({'build':'upgrade-survival-v3','protocol':1}))
        for page in [host,guest]:
            wait(page,'raftLive.build==="upgrade-survival-v3"')
            wait(page,'!!raftDebug.state.inventory && raftDebug.state.networkReady')
        wait(guest,'raftDebug.state.ownedTools.length===1')
        hs,gs=state(host),state(guest)
        assert hs['stock']['wood']==20 and hs['stock']['leaf']==10 and hs['stock']['scrap']==2,hs
        assert gs['ownedTools']==['hook'] and gs['stock']['wood']==0,gs
        assert hs['tiles']==gs['tiles']==10
        z=gs['me']['z'];guest.keyboard.down('w');guest.wait_for_timeout(400);guest.keyboard.up('w')
        wait(host,'Math.abs(raftDebug.state.other.z-'+str(z)+')>.2')
        assert state(guest)['me']['z']<z-.2
        # A guest slot selection must reach the authoritative bag after the rolling upgrade.
        guest.keyboard.press('2');guest.wait_for_timeout(600)
        assert state(guest)['selectedIndex']==1,state(guest)
        guest.keyboard.press('1')
        for page in [host,guest]:
            assert page.evaluate('performance.getEntriesByType("navigation").length')==1
            assert page.evaluate('raftLive.lastError') is None
        host.close();wait(guest,'raftDebug.state.role==="solo"')
        assert state(guest)['tiles']==11,state(guest)
        assert state(guest)['stock']['wood']==8,state(guest)
        assert not errors,errors
        print(json.dumps({'checks':['automatic rolling v2-to-v3 upgrade','host earned supplies preserved','guest has personal hook-only bag','room and movement connection retained','guest slot action acknowledged','guest own saved raft restored after disconnect','no page navigation'],'errors':errors}))
        browser.close()
finally:
    server.stop()

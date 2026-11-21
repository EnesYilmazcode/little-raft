"""Verify automatic polling on the real feed, including a connected pair."""
from playwright.sync_api import sync_playwright
from pathlib import Path
import json, subprocess, sys, time

with sync_playwright() as p:
    b=p.chromium.launch(channel='chrome',headless=True)
    contexts=[b.new_context(viewport={'width':1280,'height':800}) for _ in range(2)]
    pages=[c.new_page() for c in contexts]
    errors=[]
    for page in pages:
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto('http://127.0.0.1:41896')
        page.wait_for_function('!!window.raftDebug')
    host,guest=pages
    host.locator('#welcomeCrew').click();host.locator('#host').click()
    host.wait_for_function('document.querySelector("#roomCode").textContent.length===6')
    code=host.locator('#roomCode').inner_text()
    guest.locator('#welcomeCrew').click();guest.locator('#roomInput').fill(code)
    guest.locator('#joinForm button').click()
    for page in pages:page.wait_for_function('window.raftDebug.state.networkReady')
    before=[page.evaluate('({build:raftLive.build,state:raftDebug.state})') for page in pages]
    # Publish identical, already tested code under a new release id. No forced check().
    subprocess.run([sys.executable,'publish_local.py','.qa/release/dist','--label','v2-auto-verified'],check=True)
    target=json.loads(Path('dist/version.json').read_text())['build']
    started=time.monotonic()
    for page in pages:
        page.wait_for_function('(build)=>raftLive.build===build',arg=target,timeout=25000)
    for i,page in enumerate(pages):
        after=page.evaluate('raftDebug.state')
        assert after['networkReady'],after
        assert after['tiles']==before[i]['state']['tiles']
        assert after['stock']==before[i]['state']['stock']
        assert page.evaluate('performance.getEntriesByType("navigation").length')==1
        assert page.evaluate('raftLive.lastError') is None
    assert not errors,errors
    print(json.dumps({'checks':['automatic polling without manual check','both connected players updated','connection retained','raft and supplies retained','no page navigation'],'build':target,'seconds':round(time.monotonic()-started,2)}))
    b.close()

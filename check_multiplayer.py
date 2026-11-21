from playwright.sync_api import sync_playwright
from pathlib import Path
import json,os
URL=os.environ.get('RAFT_QA_URL','http://127.0.0.1:41897')
def state(page):return page.evaluate('window.raftDebug.state')
def wait(page,expr):page.wait_for_function(expr,timeout=30000)
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=True)
 ca=b.new_context(viewport={'width':1440,'height':900});cb=b.new_context(viewport={'width':1440,'height':900})
 for c in [ca,cb]:c.add_init_script("HTMLCanvasElement.prototype.requestPointerLock=function(){return Promise.reject(new Error('QA fallback'))};")
 saved={'tiles':[[x,z] for z in [-1,0,1] for x in [-1,0,1]]+[[2,0]],'decor':[],'stock':{'wood':18,'leaf':9,'scrap':4},'fish':3,'collected':2,'hookHealth':80}
 cb.add_init_script('localStorage.setItem("little-raft-v1",'+json.dumps(json.dumps(saved))+');')
 host=ca.new_page();guest=cb.new_page();errors=[]
 for page in [host,guest]:
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(URL);wait(page,'!!window.raftDebug')
 host.locator('#welcomeCrew').click();host.locator('#host').click();wait(host,'document.querySelector("#roomCode").textContent.length===6')
 code=host.locator('#roomCode').inner_text()
 guest.locator('#welcomeCrew').click();guest.locator('#roomInput').fill(code);guest.locator('#joinForm button').click();wait(guest,'window.raftDebug.state.networkReady');wait(host,'!!window.raftDebug.state.other')
 assert state(guest)['tiles']==state(host)['tiles']==9
 assert state(host)['other']['x']!=state(host)['me']['x']
 # Let mouse-lock fail once so both test pages use normal mouse rays.
 for page in [host,guest]:page.mouse.click(720,450);page.wait_for_timeout(100)
 hostBefore=state(host);guestBefore=state(guest)
 css=Path('.qa/release/dist/graphics.css');original=css.read_bytes()
 try:
  css.write_bytes(original+b'\n/* multiplayer-live-qa */\n')
  results=[page.evaluate('window.raftLive.check()') for page in [host,guest]]
  assert all(r['status'] in ['updated','current'] for r in results),results
  assert state(host)['networkReady'] and state(guest)['networkReady']
  assert state(host)['tiles']==hostBefore['tiles'] and state(guest)['stock']==guestBefore['stock']
  oldz=state(guest)['me']['z'];guest.keyboard.down('w');guest.wait_for_timeout(400);guest.keyboard.up('w');guest.wait_for_timeout(500)
  assert state(guest)['me']['z']<oldz-.2
  assert abs(state(host)['other']['z']-state(guest)['me']['z'])<.15
  guest.keyboard.press('2');guest.wait_for_timeout(100)
  spots=guest.evaluate('window.raftDebug.placements.filter(t=>t.screen?.visible&&t.screen.y>220&&t.screen.y<660&&t.screen.x>280&&t.screen.x<1150)')
  assert spots,'No visible build candidates'
  s=spots[0]['screen'];guest.mouse.click(s['x'],s['y']);wait(host,'window.raftDebug.state.tiles===10');wait(guest,'window.raftDebug.state.tiles===10')
  assert state(host)['stock']==state(guest)['stock']
  assert host.evaluate('performance.getEntriesByType("navigation").length')==guest.evaluate('performance.getEntriesByType("navigation").length')==1
  host.close();wait(guest,'window.raftDebug.state.role==="solo"')
  assert state(guest)['tiles']==10 and state(guest)['stock']==saved['stock'] and state(guest)['fish']==3,state(guest)
  assert not errors,errors
  print(json.dumps({'checks':['two-player room','separate avatars','live update preserves room and world','movement still syncs after update','guest building spends shared stock','guest personal save restored after host leaves'],'errors':errors}))
 finally:
  css.write_bytes(original);b.close()

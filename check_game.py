from playwright.sync_api import sync_playwright
from pathlib import Path
import json,os
URL=os.environ.get('RAFT_QA_URL','http://127.0.0.1:41897')

with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=True)
 context=b.new_context(viewport={'width':1440,'height':900})
 context.add_init_script('''HTMLCanvasElement.prototype.requestPointerLock = function(){return Promise.reject(new Error('QA fallback'))};''')
 page=context.new_page();errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('console',lambda msg:errors.append(msg.text) if msg.type=='error' else None)
 page.on('response',lambda response:print('HTTP_ERROR',response.status,response.url) if response.status>=400 else None)
 page.goto(URL);page.wait_for_function('!!window.raftDebug')
 page.locator('.ob-item[data-act="new"]:visible, #solo:visible').first.click();page.wait_for_timeout(300)
 initial=page.evaluate('window.raftDebug.state')
 assert initial['camera']['fov']>=50 and initial['camera']['y']<3,initial
 page.keyboard.down('w');page.wait_for_timeout(400);page.keyboard.up('w')
 moved=page.evaluate('window.raftDebug.state')
 assert moved['me']['z']<initial['me']['z']-.25,(initial,moved)
 page.keyboard.press('2')
 spots=page.evaluate('window.raftDebug.placements.filter(t=>t.screen?.visible && t.screen.y>220 && t.screen.y<650 && t.screen.x>300 && t.screen.x<1140)')
 if spots:
  spot=spots[0]['screen'];page.mouse.click(spot['x'],spot['y']);page.wait_for_timeout(500)
  assert page.evaluate('window.raftDebug.state.tiles')==10,page.evaluate('window.raftDebug.state')
 page.keyboard.press('1')
 page.screenshot(path='.qa/first-person.png')
 before=page.evaluate('window.raftDebug.state');oldbuild=page.evaluate('window.raftLive.build')
 css=Path('.qa/release/dist/graphics.css');original=css.read_bytes();css.write_bytes(original+b'\n/* live-qa */\n')
 result=page.evaluate('window.raftLive.check()')
 page.wait_for_timeout(500)
 after=page.evaluate('window.raftDebug.state')
 assert result['status']=='updated',result
 assert before['tiles']==after['tiles'] and before['stock']==after['stock'],(before,after)
 assert abs(before['me']['z']-after['me']['z'])<.01,(before,after)
 assert page.evaluate('performance.getEntriesByType("navigation").length')==1
 assert not errors,errors
 print(json.dumps({'checks':['first-person camera','keyboard movement','floor placement' if spots else 'no visible floor placement','live scene swap without navigation','state and position preserved'],'buildBefore':oldbuild,'buildAfter':page.evaluate('window.raftLive.build'),'errors':errors}))
 css.write_bytes(original)
 b.close()

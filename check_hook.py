from playwright.sync_api import sync_playwright
import json
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=True)
 c=b.new_context(viewport={'width':1440,'height':900});c.add_init_script("HTMLCanvasElement.prototype.requestPointerLock=function(){return Promise.reject(new Error('QA fallback'))};")
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:41897');page.wait_for_function('!!window.raftDebug');page.locator('#solo').click();page.wait_for_timeout(200)
 targets=page.evaluate('window.raftDebug.targets.filter(t=>t.screen?.visible&&t.distance<22&&t.screen.x>300&&t.screen.x<1100&&t.screen.y>250&&t.screen.y<650).sort((a,b)=>a.distance-b.distance)')
 assert targets,'No visible supplies';target=targets[0];s=target['screen']
 page.mouse.move(s['x'],s['y']);page.mouse.down();page.wait_for_timeout(950)
 assert page.evaluate('window.raftDebug.state.charge')>.9
 page.screenshot(path='.qa/pullback.png');page.mouse.up()
 page.wait_for_function('window.raftDebug.state.hookStage==="floating"',timeout=4000)
 state=page.evaluate('window.raftDebug.state');assert state['collected']==0 and state['hookHealth']==98,state
 assert state['hookCaught'],state
 page.mouse.down();page.wait_for_function('window.raftDebug.state.hookStage==="idle"',timeout=7000);page.mouse.up()
 state=page.evaluate('window.raftDebug.state');assert state['collected']==1,state
 page.keyboard.press('r');page.wait_for_function('window.raftDebug.state.hookHealth===100')
 assert not errors,errors
 print(json.dumps({'checks':['visible charge pullback','manual cast','no automatic collection','hold to reel collects once','hook wears and repairs'],'caught':target['type'],'errors':errors}))
 b.close()

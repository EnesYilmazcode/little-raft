from playwright.sync_api import sync_playwright
import json
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=True)
 page=b.new_page(viewport={'width':1440,'height':900});page.goto('http://127.0.0.1:41897');page.wait_for_function('!!window.raftDebug')
 page.locator('#solo').click();page.wait_for_function('!!document.pointerLockElement')
 page.keyboard.press('Escape');page.wait_for_function('document.querySelector("#options")?.open')
 assert page.evaluate('!document.pointerLockElement')
 page.locator('#options input[name="fov"]').evaluate('(el)=>{el.value=85;el.dispatchEvent(new Event("input",{bubbles:true}));}')
 page.locator('#options input[name="sensitivity"]').evaluate('(el)=>{el.value=1.4;el.dispatchEvent(new Event("input",{bubbles:true}));}')
 page.locator('#options button[data-act="resume"]').click();page.wait_for_function('!document.querySelector("#options").open')
 page.wait_for_function('window.raftDebug.state.camera.fov===85')
 assert json.loads(page.evaluate('localStorage.getItem("little-raft-settings")'))['sensitivity']==1.4
 page.keyboard.press('Escape');page.wait_for_function('document.querySelector("#options").open');page.screenshot(path='.qa/settings.png')
 print(json.dumps({'checks':['mouse captured during play','Escape releases mouse and opens pause settings','Resume closes menu','FOV applies','sensitivity saved']}))
 b.close()

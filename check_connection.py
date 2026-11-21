from playwright.sync_api import sync_playwright
import json

with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=True)
 a=b.new_context(viewport={'width':1280,'height':720});c=b.new_context(viewport={'width':1280,'height':720})
 host=a.new_page();guest=c.new_page();errors=[]
 for page in [host,guest]:
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://localhost:8766')
  page.wait_for_function('!!window.raftDebug')
 host.locator('#welcomeCrew').click();host.locator('#host').click()
 host.wait_for_function('document.querySelector("#roomCode").textContent.length===6',timeout=30000)
 code=host.locator('#roomCode').inner_text()
 guest.locator('#welcomeCrew').click();guest.locator('#roomInput').fill(code);guest.locator('#joinForm button').click()
 guest.wait_for_function('window.raftDebug.state.networkReady',timeout=30000)
 host.wait_for_function('window.raftDebug.state.networkReady',timeout=10000)
 print(json.dumps({'room':code,'host':host.evaluate('window.raftDebug.state'),'guest':guest.evaluate('window.raftDebug.state'),'errors':errors}))
 b.close()

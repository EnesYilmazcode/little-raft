"""Exercise real inputs, crafting, bag moves, movement and a live engine handoff."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json, os, time

URL=os.environ.get('RAFT_QA_URL','http://127.0.0.1:41903')
DIST=Path(os.environ.get('RAFT_DIST','.qa/survival/dist')).resolve()
assert DIST != Path(__file__).resolve().parent/'dist', 'This check mutates only an isolated candidate.'
def state(page):return page.evaluate('raftDebug.state')
def wait(page,expression):page.wait_for_function(expression,timeout=15000)
def press_for(page,key,ms):
    page.keyboard.down(key);page.wait_for_timeout(ms);page.keyboard.up(key)

with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    errors=[]
    page=browser.new_page(viewport={'width':1440,'height':900})
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL);wait(page,'!!window.raftDebug');page.locator('.ob-item[data-act="new"]:visible, #solo:visible').first.click()
    wait(page,'raftDebug.state.running')
    s=state(page)
    assert s['ownedTools']==['hook'],s
    assert [x for x in s['inventory']['slots'] if x]==[{'kind':'hook','count':1,'durability':100}],s
    assert page.locator('.tools > button').count()==8
    assert not page.locator('header').is_visible()
    y=s['physics']['y'];page.keyboard.down('Space');page.wait_for_timeout(180)
    assert state(page)['physics']['y']>y+.25,state(page)
    page.keyboard.up('Space');wait(page,'raftDebug.state.grounded')
    page.mouse.move(720,450);page.mouse.wheel(0,130);page.wait_for_timeout(150)
    assert state(page)['selectedIndex']==1,state(page)
    assert state(page)['heldKind'] is None,state(page)
    page.keyboard.press('1');page.keyboard.press('Tab')
    wait(page,'raftDebug.state.inventoryOpen')
    assert page.locator('#inventory [data-index]').count()==28
    assert page.locator('#inventory [data-recipe="hammer"]').is_disabled()
    page.keyboard.press('Escape');wait(page,'!raftDebug.state.inventoryOpen')
    page.wait_for_timeout(250)
    assert not page.locator('#options').evaluate('(el)=>el.open'), 'Closing the bag must not open Pause'
    page.wait_for_timeout(1000);page.mouse.click(720,450)
    wait(page,'!!document.pointerLockElement')
    press_for(page,'w',2600);page.wait_for_timeout(600)
    assert state(page)['swimming'],state(page)
    page.keyboard.down('Space');press_for(page,'s',2300);page.keyboard.up('Space')
    wait(page,'!raftDebug.state.swimming')
    page.screenshot(path='.qa/survival-first-person.png')
    page.close()

    slots=[None]*28
    slots[0]={'kind':'hook','count':1,'durability':55}
    slots[1]={'kind':'wood','count':20};slots[2]={'kind':'wood','count':5}
    slots[3]={'kind':'leaf','count':4};slots[4]={'kind':'plastic','count':10}
    saved={'tiles':[[x,z] for z in [-1,0,1] for x in [-1,0,1]],'decor':[],
           'stock':{},'fish':0,'collected':1,'hostInventory':{'slots':slots,'selected':0}}
    context=browser.new_context(viewport={'width':1440,'height':900})
    context.add_init_script('localStorage.setItem("little-raft-v1",'+json.dumps(json.dumps(saved))+');')
    context.add_init_script('HTMLCanvasElement.prototype.requestPointerLock=function(){return Promise.reject(new Error("Unavailable in this environment"))};')
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL);wait(page,'!!window.raftDebug');page.locator('.ob-item[data-act="new"]:visible, #solo:visible').first.click()
    wait(page,'raftDebug.state.running');page.keyboard.press('Tab')
    wait(page,'raftDebug.state.inventoryOpen')
    craft_box=page.locator('#inventory .sv-craft').bounding_box()
    bag_box=page.locator('#inventory .sv-bag').bounding_box()
    assert craft_box['width']>=250 and bag_box['x']>=craft_box['x']+craft_box['width'],(craft_box,bag_box)
    assert craft_box['x']>=0 and bag_box['x']+bag_box['width']<=1440,(craft_box,bag_box)
    assert page.locator('.tools [data-slot="0"] .sv-dur > i').evaluate('(el)=>el.style.width')=='55%'
    for _ in range(2):
        page.locator('#inventory [data-recipe="rope"]').click();page.wait_for_timeout(100)
    page.locator('#inventory [data-recipe="hammer"]').click();page.wait_for_timeout(150)
    assert state(page)['stock'].get('hammer')==1,state(page)
    assert state(page)['stock'].get('wood')==21,state(page)
    inventory=state(page)['inventory']['slots']
    small=next(i for i,x in enumerate(inventory) if x and x['kind']=='wood' and x['count']==1)
    hammer_slot=next(i for i,x in enumerate(inventory) if x and x['kind']=='hammer')
    page.locator(f'#inventory [data-index="{small}"]').click()
    # Move the one-wood stack from hotbar into the backpack.
    page.locator('#inventory [data-index="8"]').click();page.wait_for_timeout(100)
    assert state(page)['inventory']['slots'][8]['count']==1,state(page)
    before=state(page)
    page.screenshot(path='.qa/survival-inventory.png')
    css=DIST/'graphics.css';manifest=DIST/'version.json'
    css_old=css.read_bytes();manifest_old=manifest.read_bytes()
    try:
        css.write_bytes(css_old+b'\n/* survival handoff check */\n')
        version=json.loads(manifest_old);version['build']='survival-qa-'+str(int(time.time()))
        manifest.write_text(json.dumps(version),encoding='utf-8')
        result=page.evaluate('raftLive.check()')
        assert result['status']=='updated',result
        page.wait_for_timeout(150)
        after=state(page)
        assert after['inventory']==before['inventory'],(before,after)
        assert after['inventoryOpen'],after
        assert after['tiles']==before['tiles']
        page.keyboard.press('Tab');wait(page,'!raftDebug.state.inventoryOpen')
        page.keyboard.press(str(hammer_slot+1));page.wait_for_timeout(150)
        assert state(page)['heldKind']=='hammer',state(page)
        spots=page.evaluate('raftDebug.placements.filter(t=>t.screen?.visible&&t.screen.y>180&&t.screen.y<680&&t.screen.x>180&&t.screen.x<1260)')
        assert spots,'No visible adjacent floor to build'
        spot=spots[0]['screen'];page.mouse.click(spot['x'],spot['y']);page.wait_for_timeout(200)
        assert state(page)['tiles']==before['tiles']+1,state(page)
        assert state(page)['stock']['wood']==19 and state(page)['stock']['plastic']==8,state(page)
        page.keyboard.down('w');page.wait_for_timeout(250);page.keyboard.up('w')
        assert state(page)['physics']['z']<before['physics']['z']-.1,state(page)
        assert page.evaluate('performance.getEntriesByType("navigation").length')==1
    finally:
        css.write_bytes(css_old);manifest.write_bytes(manifest_old)
    assert not errors,errors
    print(json.dumps({'checks':['fresh hook only','8 slots and 20-stack inventory','jump, fall, swim and climb','scroll selection','real crafting costs','move stacks','worn durability display','inventory and inputs survive live swap'],'errors':errors}))
    browser.close()

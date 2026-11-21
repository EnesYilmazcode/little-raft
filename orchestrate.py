"""Bounded Claude Code workers: isolated files, captured logs, no terminal windows."""
from pathlib import Path
import subprocess, json, shutil, time

ROOT = Path(__file__).resolve().parent
TEAM = ROOT / '.team'
SOURCE_DIST = ROOT / 'dist'
WORKER_TOOLS='Read,Edit,Write,Glob,Grep'
JOBS = {
 'engine': '''Implement first-person gameplay in dist/game.js ONLY. This is a small friendly 3D browser raft game for two brothers, youngest age six. Existing implementation is third person. Convert ACTIVE gameplay to true first person: camera at eye height following me, WASD moves relative to view yaw, mouse look via pointer lock on canvas click (graceful drag-look fallback when unavailable), clamp pitch, prevent walking off raft, Escape releases cursor to click menus. Start/welcome can keep cinematic camera. Hold a nice simple 3D hook viewmodel attached to camera with rope casts originating by the hand. Casting uses center-screen ray in pointer lock, mouse ray in unlocked mode. Build ghost updates continuously from center ray when locked; allow clicking HUD recipes by releasing pointer lock when selecting build then click canvas to resume. Fishing and crafting must still work. Add keyboard E to release pointer lock/open crafting if useful. Hide local avatar head/body from camera but keep remote avatar visible at world coordinates. Import createAvatar from ./avatar.js and call createAvatar(T, color), returning a THREE.Group with head y about 1.5-1.8 and feet at zero. Another worker owns avatar.js. UI worker adds #crosshair, #resumeHint and updates controls; use these IDs if needed, gracefully. World floor top .2, eye height 1.8. Maintain network shared state, auto-save, and all existing gameplay. Do not change PeerJS architecture. Fix clear bugs you encounter including shared item duplicate collection (tokens already exist), guest save restoration if sensible. Expose READ ONLY diagnostic getters on window.raftDebug: state including avatar positions; project(x,y,z) -> {x,y,visible} screen pixels; targets getter returning items with projected screen coordinates; placement targets if helpful. Do not expose mutating cheat hooks. No dependencies, no shell, no git, no deployment. Keep scope focused and implementation readable. Only edit dist/game.js. Return precise summary and unverified risks. You cannot run browser tests; coordinator does that. Do not spawn any additional agents.''',
 'avatars': '''Create ONLY dist/avatar.js exporting function createAvatar(T, color), returning a THREE.Group. This is a friendly low-poly 3D first-person cooperative raft game for a six-year-old and older brother. Build attractive identifiable human sailor avatars in THREE geometries/materials: feet at y=0, eye height about 1.65, head centered y about 1.6, warm skin, colored shirt, shorts, separated arms and legs, little rounded hands, friendly readable face with eyes and smile facing +Z, straw sunhat with colored band, optionally compact backpack. Keep <=45 meshes, shared per-avatar materials, no textures/external assets/fonts, no animation timer. Avatar can set userData.parts with named head, leftArm, rightArm, leftLeg, rightLeg references for future animation, but exported signature must be createAvatar(T,color) only. Materials and geometries should be owned by this avatar, independent from floor meshes that get disposed on raft rebuild. Use THREE MeshStandardMaterial, low-poly geometries, castShadow true. No imports needed except T parameter. Engine worker imports your file. Do not edit any other files. No shell, git, deployment, or additional agents. Return summary.''',
 'interface': '''Edit ONLY dist/index.html and dist/style.css. Convert UI copy and controls to first-person raft gameplay for two brothers, youngest age six. Keep sophisticated friendly ocean visual styling and existing functional IDs/data attributes exactly. Add center-screen #crosshair element hidden until active (engine worker manages visibility or you can style via body.playing), and #resumeHint for unlocked controls hint; coordinator integrates engine. ACTIVE first-person controls: WASD/arrows walk, mouse look (pointer lock on canvas click), click casts center-screen hook, Escape releases mouse for menus, 1/2/3 selects tools, Build uses recipe then aim/click adjacent cell. Start still has preview world behind it. Make all overlays avoid stealing clicks except actual controls. Crosshair pointer-events none. Make instructional guide concise kid-friendly. Header play-together still opens room modal. Give tool icons clear text labels. Ensure modal fit at 1280x720 and 390x844. Remove third-person drag/zoom instructions from main controls; optional fallback drag look can remain in help. Do not remove room code, inventory, recipes, saves, sound, error message, or any existing functional elements. No new dependencies. Do not edit game.js or avatar.js. No shell, git, deployment, or additional agents. Return exact changes and integration notes.''',
 'network-review': '''Read dist/game.js and README.md ONLY; DO NOT EDIT files. Audit multiplayer correctness for two trusted brothers sharing a raft via PeerJS and browser local saves. Identify actionable defects with precise function/condition references and minimal concrete fixes. Focus: duplicate collection, item respawn mesh type consistency, guest state overwrite/save, reconnect, premature start, input when disconnected, data validation at reasonable prototype scope, host/guest avatar synchronization, host authority on crafting cost. Do not demand production anti-cheat, servers, auth or scope expansion. Give <=8 ranked findings only if real, plus concrete browser regression scenarios coordinator can run with two contexts. No shell, git, network requests, deployment or further subagents. Return report as final output.'''
}

def launch():
    TEAM.mkdir(exist_ok=True)
    records=[]
    for name, task in JOBS.items():
        checkout=TEAM/name
        checkout.mkdir(exist_ok=True)
        shutil.copytree(SOURCE_DIST,checkout/'dist',dirs_exist_ok=True)
        shutil.copy2(ROOT/'README.md',checkout/'README.md')
        if (ROOT/'references').exists():
            shutil.copytree(ROOT/'references',checkout/'references',dirs_exist_ok=True)
        prompt='You are a bounded implementation worker coordinated by Codex. Work only in your current isolated checkout. '+task
        (checkout/'TASK.txt').write_text(prompt,encoding='utf-8')
        out=open(checkout/'result.json','w',encoding='utf-8')
        err=open(checkout/'stderr.log','w',encoding='utf-8')
        cmd=[shutil.which('claude'),'-p','--safe-mode','--output-format','json','--permission-mode','acceptEdits','--tools',WORKER_TOOLS,'--allowedTools',WORKER_TOOLS]
        proc=subprocess.Popen(cmd,cwd=checkout,stdin=subprocess.PIPE,stdout=out,stderr=err,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        proc.stdin.write(prompt.encode('utf-8'));proc.stdin.close();out.close();err.close()
        records.append({'task':name,'pid':proc.pid,'checkout':str(checkout),'started':time.time()})
    for record in records:
        (Path(record['checkout'])/'job.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
    previous=json.loads((TEAM/'jobs.json').read_text()) if (TEAM/'jobs.json').exists() else []
    (TEAM/'jobs.json').write_text(json.dumps(previous+records,indent=2),encoding='utf-8')
    print(json.dumps(records,indent=2))

if __name__=='__main__':launch()

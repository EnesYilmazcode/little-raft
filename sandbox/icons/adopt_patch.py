"""Exact drop-in patches for adopting baked item icons into dist/ (see docs/tech/icons-ADOPT.md).

  python sandbox/icons/adopt_patch.py --check   # verify every patch anchor matches current dist/ exactly once
  python sandbox/icons/adopt_patch.py --apply   # write dist/icon-atlas.js, dist/item-icons.js, patch survival-ui.js + game.js

shoot.py imports patched_survival_ui() to run the sandbox UI shots against a patched copy of the
CURRENT dist/survival-ui.js, so the screenshots prove the patch, not a mock.
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / 'dist'
HERE = Path(__file__).resolve().parent

def build_id():
    m = re.search(r"\?build=([A-Za-z0-9._-]+)'", (DIST / 'game.js').read_text())
    return m.group(1) if m else 'dev'

SURVIVAL_UI = [
    # 1. module-level registry of baked icon URLs + a revision that invalidates painted slots
    ("// Symbols that actually exist in icons.svg.\n",
     "// Baked 3D item icons (kind -> image URL) from item-icons.js. Until set, the SVG sprite is used.\n"
     "let BAKED = null, ICON_REV = 0;\n"
     "export function setItemIcons(urls) { BAKED = urls && typeof urls === 'object' ? urls : null; ICON_REV++; }\n\n"
     "// Symbols that actually exist in icons.svg.\n"),
    # 2. iconSVG: baked <img> first, existing SVG path unchanged as the fallback
    ("function iconSVG(kind) {\n  const n = norm(kind);\n",
     "function iconSVG(kind) {\n"
     "  const baked = BAKED && typeof BAKED[kind] === 'string' ? BAKED[kind] : null;\n"
     "  if (baked) return `<img class=\"sv-icon sv-baked\" src=\"${esc(baked)}\" alt=\"\" draggable=\"false\" decoding=\"async\">`;\n"
     "  const n = norm(kind);\n"),
    # 3. CSS: baked icons carry their own outline + shadow; let them use the slot's padding too
    (".sv-slot .sv-icon{display:block;width:100%;height:100%;filter:drop-shadow(0 1px 1px #0008)}\n",
     ".sv-slot .sv-icon{display:block;width:100%;height:100%;filter:drop-shadow(0 1px 1px #0008)}\n"
     ".sv-icon.sv-baked{filter:none;object-fit:contain;-webkit-user-drag:none;user-select:none;pointer-events:none}\n"
     ".sv-slot .sv-icon.sv-baked{margin:-5px;width:calc(100% + 10px);height:calc(100% + 10px)}\n"
     "#inventory .sv-req .sv-icon.sv-baked{width:22px;height:22px;margin:-2px}\n"),
    # 4. slot signature includes the icon revision so already painted slots repaint once
    ("return s.kind + ':' + s.count + ':' + (f == null ? '' : Math.round(f * 100));\n",
     "return s.kind + ':' + s.count + ':' + (f == null ? '' : Math.round(f * 100)) + ':' + ICON_REV;\n"),
    ("  if (el._svKind !== s.kind) { r.art.innerHTML = iconSVG(s.kind); el._svKind = s.kind; }\n",
     "  const ik = s.kind + '@' + ICON_REV;\n"
     "  if (el._svKind !== ik) { r.art.innerHTML = iconSVG(s.kind); el._svKind = ik; }\n"),
    # 5. recipe list rebuilds (next open) when icons change
    ("    const key = recipes.map(r => r.id).join(',');\n",
     "    const key = recipes.map(r => r.id).join(',') + '#' + ICON_REV;\n"),
]

def game_patches(b):
    return [
        (f"import {{ createSurvivalUI }} from './survival-ui.js?build={b}';\n",
         f"import {{ createSurvivalUI, setItemIcons }} from './survival-ui.js?build={b}';\n"
         f"import {{ bakeItemIcons }} from './item-icons.js?build={b}';\n"),
        # bake after the first frames are up; SVG icons show until the PNGs exist; cached per build
        ("    active = true; last = performance.now(); rafId = requestAnimationFrame(animate);\n  } catch (e) {\n",
         "    active = true; last = performance.now(); rafId = requestAnimationFrame(animate);\n"
         "    later(() => { if (!renderer) return; const iconBuild = new URL(import.meta.url).searchParams.get('build') || 'dev';\n"
         "      bakeItemIcons(T, renderer, mat, iconBuild, Object.keys(ITEM_INFO)).then(urls => { if (!disposed && urls) setItemIcons(urls); }, e => console.warn('item icon bake failed, keeping SVG icons', e)); }, 400);\n"
         "  } catch (e) {\n"),
    ]

def apply(src, patches, name):
    for old, new in patches:
        n = src.count(old)
        if n != 1: raise SystemExit(f'{name}: anchor found {n} times, expected 1:\n{old}')
        src = src.replace(old, new)
    return src

def patched_survival_ui(sandbox_copy=False):
    src = apply((DIST / 'survival-ui.js').read_text(), SURVIVAL_UI, 'survival-ui.js')
    if sandbox_copy:  # served from sandbox/icons/_patched/: point relative URLs back at dist/
        src = src.replace("from './inventory-state.js?build=", "from '../../../dist/inventory-state.js?build=")
        src = src.replace("new URL('icons.svg', import.meta.url)", "new URL('../../../dist/icons.svg', import.meta.url)")
    return src

def dist_item_icons(b):
    src = (HERE / 'item-models.js').read_text()
    src = re.sub(r"from '\.\./\.\./dist/([a-z-]+)\.js'", lambda m: f"from './{m.group(1)}.js?build={b}'", src)
    return src.replace("from './icon-atlas.js'", f"from './icon-atlas.js?build={b}'")

if __name__ == '__main__':
    b = build_id()
    ui = patched_survival_ui()
    game = apply((DIST / 'game.js').read_text(), game_patches(b), 'game.js')
    items = dist_item_icons(b)
    if '--apply' in sys.argv:
        (DIST / 'survival-ui.js').write_text(ui)
        (DIST / 'game.js').write_text(game)
        (DIST / 'icon-atlas.js').write_text((HERE / 'icon-atlas.js').read_text())
        (DIST / 'item-icons.js').write_text(items)
        print('applied: dist/icon-atlas.js, dist/item-icons.js, dist/survival-ui.js, dist/game.js (build', b + ')')
    else:
        print('ok: all anchors match current dist/ exactly once (build', b + ')')

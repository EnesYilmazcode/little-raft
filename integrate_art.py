from pathlib import Path
import shutil,re,json
root=Path(__file__).resolve().parent
for task,files in {'icons':['icons.svg'],'hud-art':['graphics.css']}.items():
 result=json.loads((root/'.team'/task/'result.json').read_text(encoding='utf-8'))
 if result.get('is_error'):raise RuntimeError(task+' failed')
 for f in files:shutil.copy2(root/'.team'/task/'dist'/f,root/'dist'/f)
p=root/'dist/index.html';s=p.read_text(encoding='utf-8')
def icon(name):return '<svg class="icon" viewBox="0 0 48 48" aria-hidden="true"><use href="icons.svg#icon-'+name+'"></use></svg>'
s=s.replace('<link rel="stylesheet" href="style.css">','<link rel="stylesheet" href="style.css"><link rel="stylesheet" href="graphics.css">')
s=re.sub(r'<span class="brand-icon">.*?</span>','<span class="brand-icon">'+icon('sail')+'</span>',s)
s=re.sub(r'(<button id="crewButton">).*?(</button>)',r'\g<1>'+icon('crew')+' Play together'+r'\g<2>',s)
s=re.sub(r'(<button id="helpButton"[^>]*>).*?(</button>)',r'\g<1>'+icon('help')+r'\g<2>',s)
for name in ['wood','leaf','scrap']:
 s=re.sub(r'<b>[^<]*(<strong id="'+name+'")','<b>'+icon(name)+r' \1',s)
for tool,art in [('hook','hook'),('build','hammer'),('fish','fish')]:
 s=re.sub(r'(<button[^>]*data-tool="'+tool+r'"[^>]*><kbd>.*?</kbd><span[^>]*>).*?(</span>)',r'\g<1>'+icon(art)+r'\g<2>',s)
s=s.replace('aria-label="Close">×</button>','aria-label="Close">'+icon('close')+'</button>')
s=s.replace('<div id="toast"','<div id="durability"><span>HOOK CONDITION <b class="durability-value" id="conditionValue">100%</b></span><div class="durability-track"><i id="conditionBar"></i></div><button id="repairButton" aria-label="Repair hook">'+icon('repair')+' Repair <kbd>R</kbd><small>2 wood · 1 scrap</small></button></div><div id="chargeMeter" hidden><span>THROW POWER</span><i></i></div><div id="toast"',1)
p.write_text(s,encoding='utf-8')
print('Integrated custom SVG icons, HUD skin, and durability controls.')

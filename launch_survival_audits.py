import orchestrate as o
o.SOURCE_DIST=o.ROOT/'.qa/survival/dist'
o.JOBS={
 'survival-network-audit': '''READ ONLY audit of dist/game.js new survival integration. Focus real hot-update handoff from v2 world/peer to v3; same-v3 hot handoff; host authoritative guest personalBag, seq/ack; guest disconnect restores ownBag/world; exact listener teardown ownership. Read dist/live.js and survival-ui.js only where needed. Return <=5 actionable high-confidence defects with exact code/conditions and smallest fix. No speculative security or unsupported scope. No edits, no shell, no subagents.''',
 'survival-input-audit': '''READ ONLY audit dist/game.js, survival-ui.js, settings.js. Focus Escape/Tab/I dialog and pointerlock transitions, number/scroll actual hotbar, jump/swim controls, firstperson pointercapture after hot swap, callback lifecycle ownership. Also identify actual bugs in held-modelvisibility/bodycamera only if clear. Return <=5 high-confidence defects and minimal fixes; no general praise, no style suggestions, no speculative issues. No edits, no shell, no subagents.'''
}
o.launch()

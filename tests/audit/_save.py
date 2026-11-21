"""Save fixtures for audit browser tests."""
import json

def rod_save(selected=0):
    slots = [None] * 28
    slots[0] = {'kind': 'hook', 'count': 1, 'durability': 100}
    slots[1] = {'kind': 'fishingrod', 'count': 1, 'durability': 100}
    save = {'tiles': [[i % 3 - 1, i // 3 - 1] for i in range(9)], 'decor': [], 'stock': {}, 'fish': 0, 'collected': 0,
            'hookHealth': 100, 'items': [], 'hostInventory': {'slots': slots, 'selected': selected}, 'guestInventory': None}
    return f"localStorage.setItem('little-raft-v1', {json.dumps(json.dumps(save))})"

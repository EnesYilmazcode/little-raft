// Small pure helpers for co-op liveness, save revisions and live-update decisions. No DOM, no Three.js.

export const PROTOCOL = 1;          // engine/network protocol of this build; live.js compares manifests against it
export const NET_STALE_MS = 20000;  // a visible peer silent for this long is treated as gone
export const HEARTBEAT_MS = 1000;   // setInterval keep-alive (browsers may throttle it in hidden tabs)

// True when a peer should be dropped for silence. A peer that told us it is hidden is never timed out:
// its rAF is stopped and its timers may be throttled, so only the data channel's 'close' ends the session.
export function peerStale(now, lastMessage, peerHidden, timeout = NET_STALE_MS) {
  if (peerHidden) return false;
  return Number.isFinite(lastMessage) && now - lastMessage > timeout;
}

// Fixed-interval wall-clock timer: returns {due, next}. `next` is the new "last fired" time.
export function wallTick(now, lastAt, intervalMs) {
  if (!Number.isFinite(lastAt) || now - lastAt >= intervalMs) return {due:true, next:now};
  return {due:false, next:lastAt};
}

// Revision stored with a save string. Missing, malformed or older saves count as 0.
export function saveRevision(raw) {
  if (typeof raw !== 'string' || !raw) return 0;
  try { const v = JSON.parse(raw); return Number.isInteger(v?.rev) && v.rev > 0 ? v.rev : 0; } catch { return 0; }
}

// Decides whether this tab may write its save. `baseRev` is the revision this tab last loaded or wrote.
// A stored revision newer than that came from another tab, so writing would overwrite newer progress.
export function planSave(storedRaw, baseRev) {
  const stored = saveRevision(storedRaw), base = Number.isInteger(baseRev) && baseRev > 0 ? baseRev : 0;
  if (stored > base) return {ok:false, stored, rev:base};
  return {ok:true, stored, rev:Math.max(stored, base) + 1};
}

// Puts back the property `key` of `target` (a descriptor from before we replaced it, or undefined), unless
// something newer than `mine` has taken it since. Used when a hot-swap mount fails or a settings instance dies.
export function restoreGlobal(target, key, previous, mine) {
  const cur = Object.getOwnPropertyDescriptor(target, key);
  if (cur && !('value' in cur && cur.value === mine)) return false;
  try { if (previous) Object.defineProperty(target, key, previous); else delete target[key]; return true; } catch { return false; }
}

// Whether another tab's write (storage event) should stop this tab's autosave. Only a tab that is playing
// has progress to protect; a tab on the title adopts the newer save when it starts (adoptOnStart).
export function storageBlocks({running, role, newRaw, baseRev}) {
  return !!running && role !== 'guest' && saveRevision(newRaw) > (Number.isInteger(baseRev) ? baseRev : 0);
}

// A tab leaving the title for play (not as a guest) loads the stored save first when it is newer than ours.
export function adoptOnStart({running, role, storedRev, saveRev}) {
  return !running && role !== 'guest' && storedRev > saveRev;
}

// A guest going back to its own raft. If another tab (e.g. the host in this browser) saved since we joined,
// show that save read-only and stay blocked: adopting its rev would race that tab's autosave and block it.
export function guestLeavePlan(storedRev, saveRev) {
  const newer = storedRev > saveRev;
  return {useBackup:!newer, block:newer, saveRev};
}

// The save line on the title card, or '' when there is nothing to warn about.
export function titleSaveNote({available = true, blocked = false, storedRev = 0, saveRev = 0} = {}) {
  if (!available) return 'Browser storage is unavailable. This raft will not be saved.';
  if (storedRev > saveRev) return 'This raft was saved in another tab. Continue picks up that save. New game replaces it.';
  if (blocked) return 'This tab stopped saving because another tab saved this raft. New game starts a raft that saves here.';
  return '';
}

// The revision New game writes over: the player chose to replace the stored save, whichever tab wrote it.
export function newGameBaseRev(storedRev, saveRev) {
  return Math.max(Number.isInteger(storedRev) ? storedRev : 0, Number.isInteger(saveRev) ? saveRev : 0);
}

// Build named by a module URL's ?build= parameter, or null when the URL was not stamped.
export function buildFromUrl(href) {
  try { return new URL(href).searchParams.get('build') || null; } catch { return null; }
}

// What live.js should do with a manifest. `running` is {build, protocol} of the engine in this page;
// either may be null when unknown. Never hot-swap across, or into, an unknown protocol.
export function liveDecision(running, manifest, hasEngine = true) {
  if (!manifest || typeof manifest.build !== 'string') return 'none';
  if (running?.build && manifest.build === running.build) return 'current';
  if (!hasEngine) return 'swap'; // nothing is running yet (failed boot): just load it
  const p = running?.protocol;
  if (p == null || !Number.isFinite(manifest.protocol) || manifest.protocol !== p) return 'next-session';
  return 'swap';
}

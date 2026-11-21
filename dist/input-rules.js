// Little Raft - pure input helpers (no DOM, no THREE). Unit-tested in tests/input-r2.test.mjs.

// Keyboard: key state is always tracked (so keys held through a panel still count when it closes),
// but actions only fire when no panel is open. Typing in a form field neither records nor acts.
export function keyDecision({inField = false, blocked = false} = {}) {
  return {record: !inField, act: !inField && !blocked};
}

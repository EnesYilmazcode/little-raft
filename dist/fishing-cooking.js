// Fishing & cooking lane glue (placeholder until the full module lands). See docs/cloud/fishing-cooking.md.
export function createFishingCooking() {
  return {prompt:'', rodReeling:false, pointerDown:() => false, pointerUp:() => false, interact:() => false,
    update() {}, applyAction() {}, onNet() {}, capture() {}, dispose() {}};
}

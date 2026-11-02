/** A decoded-media-time lattice, independent of animation/worker completion clocks.
 * No interpolation and no invented observations. A late slot can replace at most
 * one pending bitmap in LiveVision; dropped slots remain observable gaps. */
export class FingerspellingSamplingClock {
  private lastSlot = -1;
  take(mediaSeconds:number) {
    if(!Number.isFinite(mediaSeconds)||mediaSeconds<0)return null;
    const slot=Math.floor((mediaSeconds+1e-6)*15);
    if(slot<=this.lastSlot)return null;
    this.lastSlot=slot;
    return slot;
  }
}

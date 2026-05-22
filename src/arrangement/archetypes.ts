/**
 * Archetype definitions for long arrangements.
 *
 * Each archetype is a structural shape — the seed picks one, then PRNG fills
 * in chord sequences and voicing details. Edit the table to adjust structure;
 * edit sectionBuilders.ts to adjust voice probabilities and energy curves.
 */

export interface Archetype {
  name: string;
  introLoops: number;       // 2 or 4
  a1Loops: number;          // 4 or 8 (one or two chord cycles)
  a2Loops: number;          // 0 (no A2) or 4 (one chord cycle)
  breakdownLoops: number;   // 1 or 2
  bLoops: number;           // 4 or 8
  resolutionLoops: number;  // 2 or 4
}

/**
 * Six archetypes covering different structural feels.
 * Range: 21-30 loops (~85-120 seconds at 120 BPM).
 * Sorted shortest → longest.
 */
export const ARCHETYPES: Archetype[] = [
  //                          intro  A1   A2  brk   B  res  total
  { name: 'Punchy',     introLoops: 2, a1Loops: 8, a2Loops: 0, breakdownLoops: 1, bLoops: 8, resolutionLoops: 2 },  // 21
  { name: 'Driving',    introLoops: 2, a1Loops: 8, a2Loops: 0, breakdownLoops: 1, bLoops: 8, resolutionLoops: 4 },  // 23
  { name: 'Dramatic',   introLoops: 2, a1Loops: 4, a2Loops: 4, breakdownLoops: 2, bLoops: 8, resolutionLoops: 4 },  // 24
  { name: 'Cruiser',    introLoops: 4, a1Loops: 8, a2Loops: 0, breakdownLoops: 1, bLoops: 8, resolutionLoops: 2 },  // 23
  { name: 'Slow Burn',  introLoops: 4, a1Loops: 8, a2Loops: 0, breakdownLoops: 2, bLoops: 8, resolutionLoops: 4 },  // 26
  { name: 'Builder',    introLoops: 4, a1Loops: 8, a2Loops: 4, breakdownLoops: 1, bLoops: 8, resolutionLoops: 2 },  // 27
  { name: 'Epic',       introLoops: 4, a1Loops: 8, a2Loops: 4, breakdownLoops: 2, bLoops: 8, resolutionLoops: 4 },  // 30
];

/** Total loops for an archetype (excluding final beat). */
export function archetypeTotalLoops(a: Archetype): number {
  return a.introLoops + a.a1Loops + a.a2Loops + a.breakdownLoops + a.bLoops + a.resolutionLoops;
}

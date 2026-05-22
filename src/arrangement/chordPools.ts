/**
 * Chord sequence pools for arrangement generation.
 *
 * All intro sequences resolve to Am — ending on E (dominant, G# tension)
 * or G (diatonic VII, softer resolution).
 */

/** 2-loop intro chord pairs (all resolve to Am). */
export const INTRO_PAIRS: string[][] = [
  ['F', 'E'],    // current short arrangement — strong V resolution
  ['Dm', 'E'],   // minor iv → V, darker setup
  ['F', 'G'],    // IV → VII, softer diatonic resolution
  ['Dm', 'G'],   // iv → VII, gentle
  ['Am', 'G'],   // i → VII, starts home then departs
  ['Am', 'E'],   // i → V, tension after brief arrival
];

/** 4-loop intro sequences (end on E or G to resolve to Am). */
export const INTRO_QUADS: string[][] = [
  ['F', 'Dm', 'F', 'E'],   // circle back before resolving — gentle
  ['Dm', 'G', 'F', 'E'],   // descending motion, strong E resolution
  ['F', 'G', 'Dm', 'E'],   // A-section feel shifted, familiar
  ['F', 'Dm', 'Am', 'G'],  // arrives home early, G sets up "real" Am entry
  ['G', 'F', 'Dm', 'E'],   // starts bright, darkens, E demands Am
];

/** A-section chord cycle pool — seed picks one. All start on Am, end on G or Em. */
export const A_CYCLES: string[][] = [
  ['Am', 'F', 'Dm', 'G'],    // original — classic natural minor
  ['Am', 'G', 'F', 'Em'],    // descending, soft Em resolution
  ['Am', 'G', 'F', 'G'],     // double G — driving, insistent
  ['Am', 'Dm', 'F', 'G'],    // iv early — darker, then lifts
  ['Am', 'Dm', 'F', 'Em'],   // iv early — stays dark through Em
  ['Am', 'Em', 'F', 'G'],    // Em early tension, F→G lifts out
  ['Am', 'F', 'Em', 'G'],    // classic IV then drops to Em before G
];

/** @deprecated Use A_CYCLES instead. Kept for test backward compat. */
export const A_CYCLE: string[] = A_CYCLES[0];

/**
 * B-section chord sequences — 8 chords each, bookended C...E.
 * C lifts into relative major, E (harmonic minor V) creates tension back to Am.
 * Middle 6 chords mix diatonic Am/Dm/Em/F/G for variety.
 */
export const B_SEQUENCES: string[][] = [
  ['C', 'F', 'Dm', 'G', 'C', 'F', 'Dm', 'E'],             // original shape, G replaces mid E
  ['C', 'Am', 'F', 'G', 'Am', 'Dm', 'F', 'E'],             // home visits, builds to E
  ['C', 'F', 'Am', 'Dm', 'G', 'F', 'Dm', 'E'],             // wandering, descends to E
  ['C', 'Dm', 'F', 'Am', 'G', 'F', 'Dm', 'E'],             // darker start, lifts then falls
  ['C', 'Am', 'Dm', 'F', 'G', 'Am', 'F', 'E'],             // two Am anchors, G lifts to E
  ['C', 'Am', 'Em', 'F', 'Dm', 'G', 'F', 'E'],             // Em early darkness, G→F→E descent
];

/** All valid B-section chord names (for test validation). */
export const B_CHORD_NAMES_SET = new Set(B_SEQUENCES.flat());

/** @deprecated Use B_SEQUENCES instead. Kept for test backward compat. */
export const B_CYCLE: string[] = ['C', 'F', 'Dm', 'E'];

/** 2-loop resolution sequences. All start on Am. */
export const RES_SHORT: string[][] = [
  ['Am', 'G'],
];

/** 4-loop resolution sequences. All start on Am, end on G or Am. */
export const RES_LONG: string[][] = [
  ['Am', 'G', 'F', 'G'],     // F adds warmth before final G
  ['Am', 'F', 'Am', 'G'],    // settles home twice, G as final departure
  ['Am', 'Dm', 'Am', 'G'],   // darker middle, then resolves
  ['Am', 'G', 'Am', 'Am'],   // holds home for the last two — definitive
];

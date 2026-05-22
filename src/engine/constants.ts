/** Voice name for the groove stab (low-register, pad-voicing stab on the groove/tom row). */
export const STAB_GROOVE = 'stab-groove';

/** Voice name for the hat stab (high-register, stab-voicing on the sparkle/hat row). */
export const STAB = 'stab';

/** Voice name for the arp. */
export const ARP = 'arp';

/** Seed for pad top-note drift PRNG. Re-seeded with variation in start(). */
export const PAD_DRIFT_SEED = 42;

/** Seed for ghost bass approach tone PRNG. */
export const GHOST_BASS_SEED = 77;

/** Seed for snare fill humanize PRNG (separate from ghost bass). */
export const FILL_HUMANIZE_SEED = 91;

/**
 * Number of beats per loop (quarter notes).
 * The grid has DEFAULT_NUM_COLS (16) eighth-note sub-columns = 8 quarter-note beats.
 */
export const BEATS_PER_LOOP = 8;

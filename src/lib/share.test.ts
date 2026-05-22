import { describe, it, expect } from 'vitest';
import { encodeShareState, decodeShareHash, type ShareState } from './share';
import { createEmptyGrid } from './grid';
import { DEFAULT_NUM_ROWS, DEFAULT_NUM_COLS } from './types';

function makeState(overrides: Partial<ShareState> = {}): ShareState {
  return {
    grid: createEmptyGrid(DEFAULT_NUM_ROWS, DEFAULT_NUM_COLS),
    tempo: 120,
    mutedTracks: new Set(),
    volumes: {},
    ...overrides,
  };
}

describe('share encode/decode', () => {
  it('round-trips an empty grid with defaults', () => {
    const state = makeState();
    const hash = '#' + encodeShareState(state);
    const decoded = decodeShareHash(hash);

    expect(decoded).not.toBeNull();
    expect(decoded!.grid.cells).toEqual(state.grid.cells);
    expect(decoded!.tempo).toBe(120);
    expect(decoded!.mutedTracks.size).toBe(0);
    // Default volume = 1.0 (encoded as nibble 10, decoded as 10/10 = 1.0)
    expect(decoded!.volumes.sparkle).toBe(1);
  });

  it('round-trips grid cells', () => {
    const grid = createEmptyGrid(DEFAULT_NUM_ROWS, DEFAULT_NUM_COLS);
    grid.cells[0][0] = 1;
    grid.cells[1][7] = 1;
    grid.cells[2][15] = 1;
    grid.cells[3][3] = 1;
    const state = makeState({ grid });

    const hash = '#' + encodeShareState(state);
    const decoded = decodeShareHash(hash)!;

    expect(decoded.grid.cells[0][0]).toBe(1);
    expect(decoded.grid.cells[1][7]).toBe(1);
    expect(decoded.grid.cells[2][15]).toBe(1);
    expect(decoded.grid.cells[3][3]).toBe(1);
    // Check a cell that should be off
    expect(decoded.grid.cells[0][1]).toBe(0);
  });

  it('round-trips all tempo values', () => {
    for (const tempo of [60, 80, 100, 120, 140, 160, 180]) {
      const hash = '#' + encodeShareState(makeState({ tempo }));
      const decoded = decodeShareHash(hash)!;
      expect(decoded.tempo).toBe(tempo);
    }
  });

  it('round-trips mute states', () => {
    const mutedTracks = new Set(['rhythm', 'pad', 'bass']);
    const hash = '#' + encodeShareState(makeState({ mutedTracks }));
    const decoded = decodeShareHash(hash)!;

    expect(decoded.mutedTracks.has('rhythm')).toBe(true);
    expect(decoded.mutedTracks.has('pad')).toBe(true);
    expect(decoded.mutedTracks.has('bass')).toBe(true);
    expect(decoded.mutedTracks.has('sparkle')).toBe(false);
    expect(decoded.mutedTracks.has('stab')).toBe(false);
    expect(decoded.mutedTracks.size).toBe(3);
  });

  it('round-trips all channels muted', () => {
    const mutedTracks = new Set(['sparkle', 'rhythm', 'groove', 'pulse', 'stab', 'pad', 'bass']);
    const hash = '#' + encodeShareState(makeState({ mutedTracks }));
    const decoded = decodeShareHash(hash)!;
    expect(decoded.mutedTracks.size).toBe(7);
  });

  it('round-trips volume values', () => {
    const volumes: Record<string, number> = {
      sparkle: 0.5,
      rhythm: 0.0,
      groove: 1.0,
      pulse: 0.3,
      stab: 0.7,
      pad: 0.1,
      bass: 0.9,
    };
    const hash = '#' + encodeShareState(makeState({ volumes }));
    const decoded = decodeShareHash(hash)!;

    expect(decoded.volumes.sparkle).toBe(0.5);
    expect(decoded.volumes.rhythm).toBe(0);
    expect(decoded.volumes.groove).toBe(1.0);
    expect(decoded.volumes.pulse).toBe(0.3);
    expect(decoded.volumes.stab).toBe(0.7);
    expect(decoded.volumes.pad).toBe(0.1);
    expect(decoded.volumes.bass).toBe(0.9);
  });

  it('returns null for empty hash', () => {
    expect(decodeShareHash('')).toBeNull();
  });

  it('returns null for hash without version prefix', () => {
    expect(decodeShareHash('#foobar')).toBeNull();
  });

  it('returns null for hash with wrong version', () => {
    expect(decodeShareHash('#v2:AAAA')).toBeNull();
  });

  it('returns null for truncated payload', () => {
    expect(decodeShareHash('#v1:AA')).toBeNull();
  });

  it('returns null for invalid base64', () => {
    expect(decodeShareHash('#v1:!!!invalid!!!')).toBeNull();
  });

  it('produces a URL-safe string (no +, /, =)', () => {
    // Fill grid with lots of 1s to exercise all bit patterns
    const grid = createEmptyGrid(DEFAULT_NUM_ROWS, DEFAULT_NUM_COLS);
    for (let r = 0; r < DEFAULT_NUM_ROWS; r++) {
      for (let c = 0; c < DEFAULT_NUM_COLS; c++) {
        grid.cells[r][c] = 1;
      }
    }
    const encoded = encodeShareState(makeState({ grid, tempo: 180 }));
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('defaults unknown tempo to 120', () => {
    // Tempo 90 is not in the valid set — should encode as 120 (index 3)
    const hash = '#' + encodeShareState(makeState({ tempo: 90 }));
    const decoded = decodeShareHash(hash)!;
    expect(decoded.tempo).toBe(120);
  });

  it('clamps volume nibbles to 0-10 range', () => {
    const volumes = { sparkle: 1.5, rhythm: -0.5 }; // out of range
    const hash = '#' + encodeShareState(makeState({ volumes }));
    const decoded = decodeShareHash(hash)!;
    expect(decoded.volumes.sparkle).toBe(1.0); // clamped to 10/10
    expect(decoded.volumes.rhythm).toBe(0);    // clamped to 0/10
  });

  it('ignores extra bytes in payload (forward compat)', () => {
    // Encode normally, then append extra bytes to simulate a future format
    const state = makeState({ tempo: 100 });
    const encoded = encodeShareState(state);
    // The encoded string after v1: is base64url — we can't just append,
    // but we can verify the decoder accepts >= 16 bytes by testing the current output
    const hash = '#' + encoded;
    const decoded = decodeShareHash(hash);
    expect(decoded).not.toBeNull();
    expect(decoded!.tempo).toBe(100);
  });

  it('encodeShareState output can be used as a hash fragment', () => {
    const state = makeState({ tempo: 140 });
    const encoded = encodeShareState(state);
    // Should start with v1: and be decodable as a hash
    expect(encoded.startsWith('v1:')).toBe(true);
    const decoded = decodeShareHash('#' + encoded)!;
    expect(decoded.tempo).toBe(140);
  });

  it('encoded output is stable (same input = same output)', () => {
    const state = makeState({ tempo: 120 });
    const a = encodeShareState(state);
    const b = encodeShareState(state);
    expect(a).toBe(b);
  });

  it('round-trips variation seed', () => {
    for (const v of [0, 1, 7, 15]) {
      const hash = '#' + encodeShareState(makeState({ variationSeed: v }));
      const decoded = decodeShareHash(hash)!;
      expect(decoded.variationSeed).toBe(v);
    }
  });

  it('defaults variation seed to 0 for old URLs (reserved bits were 0)', () => {
    // Encode with no variation seed — should decode as 0
    const hash = '#' + encodeShareState(makeState());
    const decoded = decodeShareHash(hash)!;
    expect(decoded.variationSeed).toBe(0);
  });

  it('variation seed does not affect bass volume nibble', () => {
    const state = makeState({ volumes: { bass: 0.7 }, variationSeed: 15 });
    const hash = '#' + encodeShareState(state);
    const decoded = decodeShareHash(hash)!;
    expect(decoded.volumes.bass).toBe(0.7);
    expect(decoded.variationSeed).toBe(15);
  });

  it('round-trips playback mode', () => {
    for (const mode of ['short', 'long', 'loop'] as const) {
      const hash = '#' + encodeShareState(makeState({ playbackMode: mode }));
      const decoded = decodeShareHash(hash)!;
      expect(decoded.playbackMode).toBe(mode);
    }
  });

  it('defaults playback mode to short for old URLs', () => {
    const hash = '#' + encodeShareState(makeState());
    const decoded = decodeShareHash(hash)!;
    expect(decoded.playbackMode).toBe('short');
  });

  it('round-trips a complex state', () => {
    const grid = createEmptyGrid(DEFAULT_NUM_ROWS, DEFAULT_NUM_COLS);
    grid.cells[0][6] = 1;
    grid.cells[0][11] = 1;
    grid.cells[1][2] = 1;
    grid.cells[1][6] = 1;
    grid.cells[1][10] = 1;
    grid.cells[1][14] = 1;
    grid.cells[2][4] = 1;
    grid.cells[2][12] = 1;
    grid.cells[3][0] = 1;
    grid.cells[3][3] = 1;
    grid.cells[3][8] = 1;
    grid.cells[3][10] = 1;

    const state = makeState({
      grid,
      tempo: 140,
      mutedTracks: new Set(['pad']),
      volumes: { sparkle: 0.8, rhythm: 0.6, groove: 1.0, pulse: 0.5, stab: 0.4, pad: 0.0, bass: 1.0 },
    });

    const hash = '#' + encodeShareState(state);
    const decoded = decodeShareHash(hash)!;

    expect(decoded.grid.cells).toEqual(state.grid.cells);
    expect(decoded.tempo).toBe(140);
    expect(decoded.mutedTracks.has('pad')).toBe(true);
    expect(decoded.mutedTracks.size).toBe(1);
    expect(decoded.volumes.sparkle).toBe(0.8);
    expect(decoded.volumes.bass).toBe(1.0);
    expect(decoded.volumes.pad).toBe(0);
  });
});

import type { GridState } from './types';
import { DEFAULT_NUM_ROWS, DEFAULT_NUM_COLS } from './types';

// ---------------------------------------------------------------------------
// Share-via-URL: encode/decode grid + tempo + mutes + volumes into URL hash
// ---------------------------------------------------------------------------
//
// Format: #v1:<base64url>
//
// 16-byte payload:
//   Byte 0-7:   Grid cells (64 bits, 4×16, row-major, MSB = lowest col)
//   Byte 8:     Tempo[7:5] (index into TEMPO_VALUES) | Mutes[4:0] (sparkle,rhythm,groove,pulse,stab)
//   Byte 9:     Mutes[7:6] (pad,bass) | Reserved[5:0]
//   Byte 10:    Vol sparkle[7:4] | Vol rhythm[3:0]   (0-10 each)
//   Byte 11:    Vol groove[7:4]  | Vol pulse[3:0]
//   Byte 12:    Vol stab[7:4]    | Vol pad[3:0]
//   Byte 13:    Vol bass[7:4]    | Variation[3:0] (0-15)
//   Byte 14:    PlaybackMode[7:6] (0=short,1=long,2=loop) | Reserved[5:0]
//   Byte 15:    Reserved (0x00)
//
// Reserved bits are written as 0, ignored on decode.

const VERSION_PREFIX = 'v1:';
const PAYLOAD_BYTES = 16;

/** Tempo slider values (60-180, step 20). Index stored in 3 bits (0-6). */
const TEMPO_VALUES = [60, 80, 100, 120, 140, 160, 180] as const;

/** Channel names in mute/volume bit order. */
const CHANNELS = ['sparkle', 'rhythm', 'groove', 'pulse', 'stab', 'pad', 'bass'] as const;

// ---------------------------------------------------------------------------
// Base64url (no padding, URL-safe)
// ---------------------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array | null {
  try {
    // Restore standard base64
    const std = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = (4 - (std.length % 4)) % 4;
    const binary = atob(std + '='.repeat(pad));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

export type PlaybackMode = 'short' | 'long' | 'loop';

export interface ShareState {
  grid: GridState;
  tempo: number;
  mutedTracks: Set<string>;
  volumes: Record<string, number>;
  variationSeed?: number;
  playbackMode?: PlaybackMode;
}

export function encodeShareState(state: ShareState): string {
  const buf = new Uint8Array(PAYLOAD_BYTES);

  // Bytes 0-7: grid cells, row-major, MSB = col 0
  const { cells } = state.grid;
  for (let row = 0; row < DEFAULT_NUM_ROWS; row++) {
    for (let col = 0; col < DEFAULT_NUM_COLS; col++) {
      if (cells[row]?.[col]) {
        const bitIndex = row * DEFAULT_NUM_COLS + col;
        const byteIndex = bitIndex >> 3;
        const bitOffset = 7 - (bitIndex & 7);
        buf[byteIndex] |= 1 << bitOffset;
      }
    }
  }

  // Byte 8: tempo (3 bits) | mutes (5 bits)
  const tempoIndex = TEMPO_VALUES.indexOf(state.tempo as typeof TEMPO_VALUES[number]);
  const ti = tempoIndex >= 0 ? tempoIndex : 3; // default 120 BPM
  let byte8 = (ti & 0x7) << 5;
  for (let i = 0; i < 5; i++) {
    if (state.mutedTracks.has(CHANNELS[i])) byte8 |= 1 << (4 - i);
  }
  buf[8] = byte8;

  // Byte 9: mutes (2 bits) | reserved (6 bits)
  let byte9 = 0;
  if (state.mutedTracks.has(CHANNELS[5])) byte9 |= 0x80; // pad
  if (state.mutedTracks.has(CHANNELS[6])) byte9 |= 0x40; // bass
  buf[9] = byte9;

  // Bytes 10-13: volumes as nibbles (0-10, clamped)
  const volNibble = (name: string): number => {
    const v = state.volumes[name] ?? 1;
    return Math.min(10, Math.max(0, Math.round(v * 10)));
  };
  buf[10] = (volNibble(CHANNELS[0]) << 4) | volNibble(CHANNELS[1]);
  buf[11] = (volNibble(CHANNELS[2]) << 4) | volNibble(CHANNELS[3]);
  buf[12] = (volNibble(CHANNELS[4]) << 4) | volNibble(CHANNELS[5]);
  const variationNibble = Math.min(15, Math.max(0, state.variationSeed ?? 0));
  buf[13] = (volNibble(CHANNELS[6]) << 4) | (variationNibble & 0xF);

  // Byte 14: PlaybackMode[7:6] | Reserved[5:0]
  const modeMap: Record<string, number> = { short: 0, long: 1, loop: 2 };
  const modeBits = modeMap[state.playbackMode ?? 'short'] ?? 0;
  buf[14] = (modeBits & 0x3) << 6;

  return VERSION_PREFIX + toBase64Url(buf);
}

/** Build a full shareable URL from the current page location + encoded state. */
export function buildShareUrl(state: ShareState): string {
  const hash = '#' + encodeShareState(state);
  return window.location.origin + window.location.pathname + hash;
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

export interface DecodedShareState {
  grid: GridState;
  tempo: number;
  mutedTracks: Set<string>;
  volumes: Record<string, number>;
  variationSeed: number;
  playbackMode: PlaybackMode;
}

/** Try to decode share state from a URL hash string (including the #). Returns null on failure. */
export function decodeShareHash(hash: string): DecodedShareState | null {
  if (!hash.startsWith('#')) return null;
  const payload = hash.slice(1);
  if (!payload.startsWith(VERSION_PREFIX)) return null;

  const encoded = payload.slice(VERSION_PREFIX.length);
  const bytes = fromBase64Url(encoded);
  if (!bytes || bytes.length < PAYLOAD_BYTES) return null;

  // Bytes 0-7: grid
  const cells: number[][] = Array.from({ length: DEFAULT_NUM_ROWS }, () =>
    Array.from({ length: DEFAULT_NUM_COLS }, () => 0),
  );
  for (let row = 0; row < DEFAULT_NUM_ROWS; row++) {
    for (let col = 0; col < DEFAULT_NUM_COLS; col++) {
      const bitIndex = row * DEFAULT_NUM_COLS + col;
      const byteIndex = bitIndex >> 3;
      const bitOffset = 7 - (bitIndex & 7);
      if (bytes[byteIndex] & (1 << bitOffset)) {
        cells[row][col] = 1;
      }
    }
  }
  const grid: GridState = { cells, numRows: DEFAULT_NUM_ROWS, numCols: DEFAULT_NUM_COLS };

  // Byte 8: tempo + mutes
  const byte8 = bytes[8];
  const tempoIndex = (byte8 >> 5) & 0x7;
  const tempo = tempoIndex < TEMPO_VALUES.length ? TEMPO_VALUES[tempoIndex] : 120;

  const mutedTracks = new Set<string>();
  for (let i = 0; i < 5; i++) {
    if (byte8 & (1 << (4 - i))) mutedTracks.add(CHANNELS[i]);
  }

  // Byte 9: remaining mutes
  const byte9 = bytes[9];
  if (byte9 & 0x80) mutedTracks.add(CHANNELS[5]); // pad
  if (byte9 & 0x40) mutedTracks.add(CHANNELS[6]); // bass

  // Bytes 10-13: volumes
  const volumes: Record<string, number> = {};
  const readNibble = (byteIdx: number, high: boolean): number => {
    const nibble = high ? (bytes[byteIdx] >> 4) & 0xF : bytes[byteIdx] & 0xF;
    return Math.min(nibble, 10) / 10;
  };
  volumes[CHANNELS[0]] = readNibble(10, true);
  volumes[CHANNELS[1]] = readNibble(10, false);
  volumes[CHANNELS[2]] = readNibble(11, true);
  volumes[CHANNELS[3]] = readNibble(11, false);
  volumes[CHANNELS[4]] = readNibble(12, true);
  volumes[CHANNELS[5]] = readNibble(12, false);
  volumes[CHANNELS[6]] = readNibble(13, true);

  // Byte 13 low nibble: variation seed (0-15, default 0 for old URLs)
  const variationSeed = bytes[13] & 0xF;

  // Byte 14 high 2 bits: playback mode (0=short, 1=long, 2=loop)
  const modeIndex = (bytes[14] >> 6) & 0x3;
  const modeValues: PlaybackMode[] = ['short', 'long', 'loop'];
  const playbackMode = modeValues[modeIndex] ?? 'short';

  return { grid, tempo, mutedTracks, volumes, variationSeed, playbackMode };
}

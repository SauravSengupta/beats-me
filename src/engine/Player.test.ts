/**
 * Player audio graph tests.
 *
 * Strategy: mock the entire `tone` module so we control what Tone.Gain,
 * Tone.Reverb, etc. return. This lets us inspect the graph wiring
 * (connect calls, gain values) without needing a real AudioContext.
 *
 * This catches: wrong node ordering, missing ramps, accidental disconnects.
 * This does NOT catch: actual audio output bugs (need real browser for that).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { EngineConfig } from '../lib/types';
import { configFromPreset } from '../lib/types';

// ---------------------------------------------------------------------------
// Tone.js mock — returns spyable objects for every Tone class Player uses
// ---------------------------------------------------------------------------

function makeAudioParam(initial = 1) {
  return {
    value: initial,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(function (this: { value: number }, v: number) {
      this.value = v; // simulate the ramp completing instantly
    }),
    exponentialRampToValueAtTime: vi.fn(function (this: { value: number }, v: number) {
      this.value = v; // simulate the ramp completing instantly
    }),
    setTargetAtTime: vi.fn(),
  };
}

function makeNode(extras: Record<string, unknown> = {}) {
  const node = {
    connect: vi.fn().mockReturnThis(),
    disconnect: vi.fn(),
    dispose: vi.fn(),
    toDestination: vi.fn().mockReturnThis(),
    gain: makeAudioParam(1),
    frequency: makeAudioParam(200),
    pan: makeAudioParam(0),
    triggerAttack: vi.fn(),
    triggerRelease: vi.fn(),
    ...extras,
  };
  return node;
}

// Track all created nodes so tests can inspect them
let createdNodes: { type: string; node: ReturnType<typeof makeNode>; args: unknown[] }[] = [];

vi.mock('tone', () => {
  // Use function constructors (not arrows) so `new Tone.Gain()` etc. work.
  // Each constructor assigns properties to `this` and records the node.
  function Gain(this: ReturnType<typeof makeNode>, value = 1) {
    Object.assign(this, makeNode({ gain: makeAudioParam(value) }));
    createdNodes.push({ type: 'Gain', node: this, args: [value] });
  }

  function Reverb(this: ReturnType<typeof makeNode>, _opts?: unknown) {
    Object.assign(this, makeNode({ wet: makeAudioParam(0.12) }));
    (this as Record<string, unknown>).generate = vi.fn().mockResolvedValue(undefined);
    createdNodes.push({ type: 'Reverb', node: this, args: [] });
  }

  function Compressor(this: ReturnType<typeof makeNode>, _opts?: unknown) {
    Object.assign(this, makeNode());
    createdNodes.push({ type: 'Compressor', node: this, args: [] });
  }

  function MockPlayer(this: ReturnType<typeof makeNode>, _opts?: unknown) {
    Object.assign(this, makeNode({
      loaded: true,
      volume: { value: 0, setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() },
      start: vi.fn(),
      stop: vi.fn(),
      buffer: { onload: null },
    }));
    createdNodes.push({ type: 'Player', node: this, args: [] });
  }

  function Synth(this: ReturnType<typeof makeNode>, _opts?: unknown) {
    Object.assign(this, makeNode({
      volume: { value: 0 },
      triggerAttackRelease: vi.fn(),
    }));
    createdNodes.push({ type: 'Synth', node: this, args: [] });
  }

  function PolySynth(this: ReturnType<typeof makeNode>, _Voice?: unknown, _opts?: unknown) {
    Object.assign(this, makeNode({
      volume: { value: 0 },
      triggerAttackRelease: vi.fn(),
      triggerAttack: vi.fn(),
      triggerRelease: vi.fn(),
      releaseAll: vi.fn(),
    }));
    createdNodes.push({ type: 'PolySynth', node: this, args: [] });
  }

  function Filter(this: ReturnType<typeof makeNode>, _opts?: unknown) {
    Object.assign(this, makeNode({ frequency: makeAudioParam(500) }));
    createdNodes.push({ type: 'Filter', node: this, args: [] });
  }

  function Chebyshev(this: ReturnType<typeof makeNode>, _order?: number) {
    Object.assign(this, makeNode({ wet: makeAudioParam(1) }));
    createdNodes.push({ type: 'Chebyshev', node: this, args: [] });
  }

  function FeedbackDelay(this: ReturnType<typeof makeNode>, _opts?: unknown) {
    Object.assign(this, makeNode({
      feedback: makeAudioParam(0),
      wet: makeAudioParam(0),
    }));
    createdNodes.push({ type: 'FeedbackDelay', node: this, args: [] });
  }

  function Panner(this: ReturnType<typeof makeNode>, _pan?: number) {
    Object.assign(this, makeNode({ pan: makeAudioParam(0) }));
    createdNodes.push({ type: 'Panner', node: this, args: [_pan] });
  }

  function Chorus(this: ReturnType<typeof makeNode>, _opts?: unknown) {
    Object.assign(this, makeNode({
      frequency: makeAudioParam(0.5),
      wet: makeAudioParam(0.5),
      start: vi.fn(),
      stop: vi.fn(),
    }));
    createdNodes.push({ type: 'Chorus', node: this, args: [_opts] });
  }

  function LFO(this: ReturnType<typeof makeNode>, _opts?: unknown) {
    Object.assign(this, makeNode({
      frequency: makeAudioParam(1),
      start: vi.fn(),
      stop: vi.fn(),
    }));
    createdNodes.push({ type: 'LFO', node: this, args: [] });
  }

  function Oscillator(this: ReturnType<typeof makeNode>, _opts?: unknown) {
    Object.assign(this, makeNode({
      frequency: makeAudioParam(200),
      start: vi.fn(),
      stop: vi.fn(),
    }));
    createdNodes.push({ type: 'Oscillator', node: this, args: [] });
  }

  function Noise(this: ReturnType<typeof makeNode>, _type?: string) {
    Object.assign(this, makeNode({
      start: vi.fn(),
      stop: vi.fn(),
    }));
    createdNodes.push({ type: 'Noise', node: this, args: [] });
  }

  const transport = {
    bpm: { value: 120 },
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    position: 0,
    ticks: 0,
    scheduleRepeat: vi.fn().mockReturnValue(1),
    scheduleOnce: vi.fn(),
    clear: vi.fn(),
  };

  return {
    Gain,
    Reverb,
    Compressor,
    Player: MockPlayer,
    Synth,
    PolySynth,
    Filter,
    Chebyshev,
    FeedbackDelay,
    Panner,
    Chorus,
    LFO,
    Oscillator,
    Noise,
    getTransport: () => transport,
    now: () => 0,
    start: vi.fn().mockResolvedValue(undefined),
    setContext: vi.fn(),
    Frequency: vi.fn().mockReturnValue({ toMidi: () => 45, toNote: () => 'A2', toFrequency: () => 110 }),
    Ticks: vi.fn().mockReturnValue({ valueOf: () => 96 }),
  };
});

// Must import Player AFTER vi.mock('tone')
const { Player } = await import('./Player');

// ---------------------------------------------------------------------------
// Test config
// ---------------------------------------------------------------------------

const testConfig: EngineConfig = configFromPreset({
  name: 'Test',
  tempo: 120,
  scale: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
  chordProgression: [
    {
      name: 'Am', root: 'A2', fifth: 'E2',
      padVoicing: ['A2', 'E3'], stabVoicing: ['A3', 'E4'],
    },
  ],
  kit: [
    { name: 'kick', shape: '▼', sample: '/samples/kick.wav', volumeDb: 0,
      color: { color: '#fff', glowColor: '#fff' } },
    { name: 'hat', shape: '∙', sample: '/samples/hat.wav', volumeDb: 0,
      color: { color: '#fff', glowColor: '#fff' } },
  ],
  pad: { shape: '≋', oscillator: 'fatsawtooth', spread: 30, count: 3,
    volumeDb: -21, filterLfoRange: [400, 1200], volumeLfoRange: [0.75, 1.0],
    attack: 0.3, release: 0.8 },
  bass: { shape: '∿', oscillator: 'triangle', filterCutoffHz: 500, volumeDb: 0 },
  stab: { shape: '⟁', oscillator: 'square', filterCutoffHz: 2000, volumeDb: -8,
    attack: 0.005, decay: 0.15, sustain: 0.05, release: 0.2,
    delayTime: '8n.', delayFeedback: 0.28, delayWet: 0.25 },
});

// Config with synthesized drum voices (synthType instead of sample)
const synthConfig: EngineConfig = configFromPreset({
  name: 'SynthTest',
  tempo: 120,
  scale: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
  chordProgression: [
    {
      name: 'Am', root: 'A2', fifth: 'E2',
      padVoicing: ['A2', 'E3'], stabVoicing: ['A3', 'E4'],
    },
  ],
  kit: [
    { name: 'sparkle', shape: '◇', synthType: 'synth-cymbal', volumeDb: -5,
      color: { color: '#fff', glowColor: '#fff' } },
    { name: 'rhythm', shape: '∙', synthType: 'synth-hat', volumeDb: -6,
      color: { color: '#fff', glowColor: '#fff' } },
    { name: 'groove', shape: '◻', synthType: 'noise-snare', volumeDb: -3,
      color: { color: '#fff', glowColor: '#fff' } },
    { name: 'pulse', shape: '▼', synthType: 'kick-sweep', volumeDb: 0,
      color: { color: '#fff', glowColor: '#fff' } },
  ],
  pad: { shape: '≋', oscillator: 'fatsawtooth', spread: 30, count: 3,
    volumeDb: -21, filterLfoRange: [400, 1200], volumeLfoRange: [0.75, 1.0],
    attack: 0.3, release: 0.8 },
  bass: { shape: '∿', oscillator: 'triangle', filterCutoffHz: 500, volumeDb: 0 },
  stab: { shape: '⟁', oscillator: 'square', filterCutoffHz: 2000, volumeDb: -8,
    attack: 0.005, decay: 0.15, sustain: 0.05, release: 0.2,
    delayTime: '8n.', delayFeedback: 0.28, delayWet: 0.25 },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let player: InstanceType<typeof Player>;

beforeEach(() => {
  createdNodes = [];
});

async function initPlayer() {
  player = new Player();
  await player.init(testConfig);
  return player;
}

function findNodes(type: string) {
  return createdNodes.filter((n) => n.type === type);
}

/** The first Gain created is the masterGate (Gain(0).toDestination()) */
function getMasterGate() {
  const gains = findNodes('Gain');
  return gains[0]?.node;
}

/** Bus gains are created right after masterGate and compressor:
 *  index 0 = masterGate, 1 = dryBus, 2 = plateBus, 3 = hallBus */
function getDryBus() { return findNodes('Gain')[1]?.node; }
function getPlateBus() { return findNodes('Gain')[2]?.node; }
function getHallBus() { return findNodes('Gain')[3]?.node; }

/** Shorthand: wrap a sound name into a single-item preview array */
function previewOf(sound: string) {
  return [{ row: 0, col: 0, value: 1 as const, beatOffset: 0, sound, velocity: 0.7 }];
}

// ---------------------------------------------------------------------------
// Audio graph topology
// ---------------------------------------------------------------------------

describe('Player audio graph', () => {
  it('masterGate is created with gain 0 (silent until play)', async () => {
    await initPlayer();
    const gains = findNodes('Gain');
    // First gain created should be masterGate with initial value 0
    expect(gains[0].args[0]).toBe(0);
  });

  it('masterGate connects to destination (last in chain)', async () => {
    await initPlayer();
    const gate = getMasterGate();
    expect(gate.toDestination).toHaveBeenCalled();
  });

  it('compressor connects to masterGate', async () => {
    await initPlayer();
    const compressor = findNodes('Compressor')[0].node;
    const gate = getMasterGate();
    expect(compressor.connect).toHaveBeenCalledWith(gate);
  });

  it('creates three FX buses (dry, plate, hall)', async () => {
    await initPlayer();
    const gains = findNodes('Gain');
    // masterGate(1) + dryBus(1) + plateBus(1) + hallBus(1) + per-voice gains...
    expect(gains.length).toBeGreaterThanOrEqual(4);
    // dryBus, plateBus, hallBus are gains 1, 2, 3
    expect(gains[1].args[0]).toBe(1);
    expect(gains[2].args[0]).toBe(1);
    expect(gains[3].args[0]).toBe(1);
  });

  it('dryBus connects to compressor', async () => {
    await initPlayer();
    const dryBus = getDryBus();
    const compressor = findNodes('Compressor')[0].node;
    expect(dryBus.connect).toHaveBeenCalledWith(compressor);
  });

  it('plateBus connects to plate reverb, plate reverb connects to compressor', async () => {
    await initPlayer();
    const reverbs = findNodes('Reverb');
    const compressor = findNodes('Compressor')[0].node;
    const plateBus = getPlateBus();
    // Plate reverb is first, hall reverb is second
    expect(plateBus.connect).toHaveBeenCalledWith(reverbs[0].node);
    expect(reverbs[0].node.connect).toHaveBeenCalledWith(compressor);
  });

  it('hallBus connects to hall reverb, hall reverb connects to compressor', async () => {
    await initPlayer();
    const reverbs = findNodes('Reverb');
    const compressor = findNodes('Compressor')[0].node;
    const hallBus = getHallBus();
    // Hall reverb is second
    expect(hallBus.connect).toHaveBeenCalledWith(reverbs[1].node);
    expect(reverbs[1].node.connect).toHaveBeenCalledWith(compressor);
  });

  it('drum voice gains connect to dryBus', async () => {
    await initPlayer();
    const dryBus = getDryBus();
    const gains = findNodes('Gain');
    // kick gain is index 5, hat gain is index 6 (after masterGate, dryBus, plateBus, hallBus, riserGain)
    expect(gains[5].node.connect).toHaveBeenCalledWith(dryBus);
    expect(gains[6].node.connect).toHaveBeenCalledWith(dryBus);
  });

  it('pad gain connects to hallBus', async () => {
    await initPlayer();
    const hallBus = getHallBus();
    const gains = findNodes('Gain');
    // Find pad gain by checking which gain connects to hallBus (excluding hallBus itself)
    const padGain = gains.find((g) =>
      g.node !== hallBus &&
      g.node !== getMasterGate() &&
      g.node.connect.mock.calls.some(
        (call: unknown[]) => call[0] === hallBus,
      ),
    );
    expect(padGain).toBeDefined();
  });

  it('stab gain connects to plateBus', async () => {
    await initPlayer();
    const plateBus = getPlateBus();
    const gains = findNodes('Gain');
    // Find stab gain by checking which connects to plateBus (excluding plateBus itself)
    const stabGain = gains.find((g) =>
      g.node !== plateBus &&
      g.node !== getMasterGate() &&
      g.node.connect.mock.calls.some(
        (call: unknown[]) => call[0] === plateBus,
      ),
    );
    expect(stabGain).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Riser voice
// ---------------------------------------------------------------------------

describe('Player riser', () => {
  it('riser gain is created during init', async () => {
    await initPlayer();
    // Riser gain is index 4 (after masterGate, dryBus, plateBus, hallBus)
    const gains = findNodes('Gain');
    expect(gains.length).toBeGreaterThanOrEqual(5);
    // The riser gain should have been connected to something (plateBus)
    expect(gains[4].node.connect).toHaveBeenCalled();
  });

  it('startRiser creates noise and oscillator nodes', async () => {
    await initPlayer();
    const noiseBefore = findNodes('Noise').length;
    const oscBefore = findNodes('Oscillator').length;

    player.startRiser('up', 2.0, 0.4, { freqLow: 200, freqHigh: 8000, q: 2 });

    expect(findNodes('Noise').length).toBeGreaterThan(noiseBefore);
    expect(findNodes('Oscillator').length).toBeGreaterThan(oscBefore);
  });

  it('startRiser creates a bandpass filter for the sweep', async () => {
    await initPlayer();
    const filtersBefore = findNodes('Filter').length;

    player.startRiser('up', 2.0, 0.4, { freqLow: 200, freqHigh: 8000, q: 2 });

    expect(findNodes('Filter').length).toBeGreaterThan(filtersBefore);
  });

  it('stopRiser does not throw when no riser is active', async () => {
    await initPlayer();
    expect(() => player.stopRiser()).not.toThrow();
  });

  it('starting a second riser cleans up the first', async () => {
    await initPlayer();

    player.startRiser('up', 2.0, 0.4, { freqLow: 200, freqHigh: 8000, q: 2 });

    player.startRiser('down', 2.0, 0.3, { freqLow: 400, freqHigh: 5000, q: 1.5 });
    // The first riser's noise should have been disposed
    const firstNoise = findNodes('Noise')[findNodes('Noise').length - 2]?.node;
    if (firstNoise) {
      expect(firstNoise.dispose).toHaveBeenCalled();
    }
  });
});

// ---------------------------------------------------------------------------
// Stop behavior
// ---------------------------------------------------------------------------

describe('Player.stopAll', () => {
  it('ramps masterGate gain to 0', async () => {
    await initPlayer();
    const gate = getMasterGate();
    gate.gain.value = 1;

    player.stopAll();

    expect(gate.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
  });

  it('does not disconnect masterGate', async () => {
    await initPlayer();
    const gate = getMasterGate();

    player.stopAll();

    expect(gate.disconnect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Start behavior
// ---------------------------------------------------------------------------

describe('Player.startTransport', () => {
  it('ramps masterGate gain to 1', async () => {
    await initPlayer();
    const gate = getMasterGate();

    await player.startTransport(120);

    expect(gate.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, expect.any(Number));
  });

  it('sets gain to 0 before ramping up', async () => {
    await initPlayer();
    const gate = getMasterGate();

    await player.startTransport(120);

    expect(gate.gain.setValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
  });
});

// ---------------------------------------------------------------------------
// Mute / unmute
// ---------------------------------------------------------------------------

/** Find the first per-voice drum gain: connects to dryBus but isn't the dryBus itself */
function getFirstDrumGain() {
  const dryBus = getDryBus();
  const gains = findNodes('Gain');
  return gains.find((g) =>
    g.node !== dryBus &&
    g.node !== getMasterGate() &&
    g.node.connect.mock.calls.some(
      (call: unknown[]) => call[0] === dryBus,
    ),
  )?.node;
}

describe('Player.mute / unmute', () => {
  it('mute disconnects the named voice gain', async () => {
    await initPlayer();

    player.mute('kick');

    // The gain that connects to dryBus should have been disconnected
    const drumGain = getFirstDrumGain();
    expect(drumGain?.disconnect).toHaveBeenCalled();
  });

  it('unmute reconnects the named voice gain', async () => {
    await initPlayer();
    const drumGain = getFirstDrumGain();
    const connectCountBefore = drumGain!.connect.mock.calls.length;

    player.mute('kick');
    player.unmute('kick');

    // Should have a new connect call after unmute
    expect(drumGain!.connect.mock.calls.length).toBeGreaterThan(connectCountBefore);
  });

  it('unmute reconnects to the correct destination (dryBus)', async () => {
    await initPlayer();
    const drumGain = getFirstDrumGain()!;
    const dryBus = getDryBus();

    player.mute('kick');
    player.unmute('kick');

    // Last connect call should be to the dryBus
    const lastConnect = drumGain.connect.mock.calls.at(-1);
    expect(lastConnect![0]).toBe(dryBus);
  });
});

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

describe('Player.triggerPreview', () => {
  it('opens masterGate for preview', async () => {
    await initPlayer();
    const gate = getMasterGate();

    player.triggerPreview([{ row: 0, col: 0, value: 1, beatOffset: 0, sound: 'kick', velocity: 0.7 }]);

    expect(gate.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, expect.any(Number));
  });

  it('plays multiple sounds with timing offsets', async () => {
    await initPlayer();
    const preview = [
      { row: 0, col: 0, value: 1 as const, beatOffset: 0, sound: 'kick', velocity: 0.7 },
      { row: 0, col: 0, value: 1 as const, beatOffset: 0, sound: 'bass', velocity: 0.6, note: 'A2' },
    ];
    expect(() => player.triggerPreview(preview)).not.toThrow();
  });

  it('skips pad-pulse sounds in preview', async () => {
    await initPlayer();
    const preview = [
      { row: 0, col: 0, value: 1 as const, beatOffset: 0, sound: 'pad-pulse', velocity: 0.5 },
      { row: 0, col: 0, value: 1 as const, beatOffset: 0, sound: 'kick', velocity: 0.7 },
    ];
    // Should not throw even though pad-pulse has no voice
    expect(() => player.triggerPreview(preview)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Stop then restart (the bug scenario)
// ---------------------------------------------------------------------------

describe('stop → restart cycle', () => {
  it('masterGate ramps 1→0 on stop, then 0→1 on restart', async () => {
    await initPlayer();
    const gate = getMasterGate();

    // Start
    await player.startTransport(120);
    expect(gate.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, expect.any(Number));

    // Stop
    player.stopAll();
    expect(gate.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, expect.any(Number));

    // Restart
    await player.startTransport(120);
    expect(gate.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, expect.any(Number));
  });

  it('masterGate is never disconnected during stop→restart', async () => {
    await initPlayer();
    const gate = getMasterGate();

    await player.startTransport(120);
    player.stopAll();
    await player.startTransport(120);

    expect(gate.disconnect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Dispose
// ---------------------------------------------------------------------------

describe('Player.dispose', () => {
  it('cleans up without throwing', async () => {
    await initPlayer();
    expect(() => player.dispose()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Synthesized drum voices
// ---------------------------------------------------------------------------

describe('Synth voice factory (synthType path)', () => {
  async function initSynthPlayer() {
    player = new Player();
    await player.init(synthConfig);
    return player;
  }

  it('initializes without throwing when kit uses synthType', async () => {
    await expect(initSynthPlayer()).resolves.not.toThrow();
  });

  it('creates voices for all synthType kit rows', async () => {
    await initSynthPlayer();
    // triggerPreview should not throw for any synth voice
    expect(() => player.triggerPreview(previewOf('sparkle'))).not.toThrow();
    expect(() => player.triggerPreview(previewOf('rhythm'))).not.toThrow();
    expect(() => player.triggerPreview(previewOf('groove'))).not.toThrow();
    expect(() => player.triggerPreview(previewOf('pulse'))).not.toThrow();
  });

  it('does not create Tone.Player nodes for synthType rows', async () => {
    await initSynthPlayer();
    const players = findNodes('Player');
    expect(players.length).toBe(0);
  });

  it('creates per-voice gain nodes for synth kit rows', async () => {
    await initSynthPlayer();
    const gains = findNodes('Gain');
    // masterGate(1) + dryBus(1) + plateBus(1) + hallBus(1)
    // + sparkle(1) + rhythm(1) + groove(1) + pulse(1)
    // + bass(1) + stab(1) + pad(1) + pad internal(2) = 13 minimum
    expect(gains.length).toBeGreaterThanOrEqual(11);
  });

  it('synth kick creates Oscillator and Noise on trigger', async () => {
    await initSynthPlayer();
    player.triggerPreview(previewOf('pulse'));
    expect(findNodes('Oscillator').length).toBeGreaterThanOrEqual(1);
    expect(findNodes('Noise').length).toBeGreaterThanOrEqual(1);
  });

  it('synth hat creates multiple Oscillators on trigger', async () => {
    await initSynthPlayer();
    player.triggerPreview(previewOf('rhythm'));
    // Hat creates 6 square oscillators per trigger
    expect(findNodes('Oscillator').length).toBeGreaterThanOrEqual(6);
  });

  it('synth cymbal creates Noise on trigger (no Oscillators)', async () => {
    await initSynthPlayer();
    const oscsBefore = findNodes('Oscillator').length;
    player.triggerPreview(previewOf('sparkle'));
    // Cymbal is noise-only — no new oscillators
    expect(findNodes('Oscillator').length).toBe(oscsBefore);
    expect(findNodes('Noise').length).toBeGreaterThanOrEqual(1);
  });

  it('synth snare creates both Oscillator and Noise on trigger', async () => {
    await initSynthPlayer();
    player.triggerPreview(previewOf('groove'));
    expect(findNodes('Oscillator').length).toBeGreaterThanOrEqual(1);
    expect(findNodes('Noise').length).toBeGreaterThanOrEqual(1);
  });

  it('dispose cleans up synth voices without throwing', async () => {
    await initSynthPlayer();
    // Trigger all voices to create per-hit nodes
    player.triggerPreview(previewOf('sparkle'));
    player.triggerPreview(previewOf('rhythm'));
    player.triggerPreview(previewOf('groove'));
    player.triggerPreview(previewOf('pulse'));
    expect(() => player.dispose()).not.toThrow();
  });

  it('each trigger creates new per-hit nodes (not shared)', async () => {
    await initSynthPlayer();
    // Cymbal: each trigger should create its own Gain + Filter nodes
    const nodesBefore = createdNodes.length;
    player.triggerPreview(previewOf('sparkle'));
    const nodesAfterFirst = createdNodes.length;
    const firstHitNodes = nodesAfterFirst - nodesBefore;

    player.triggerPreview(previewOf('sparkle'));
    const nodesAfterSecond = createdNodes.length;
    const secondHitNodes = nodesAfterSecond - nodesAfterFirst;

    // Second trigger should create the same number of new nodes
    expect(secondHitNodes).toBe(firstHitNodes);
  });

  it('kick per-hit nodes are independent across triggers', async () => {
    await initSynthPlayer();
    const nodesBefore = createdNodes.length;
    player.triggerPreview(previewOf('pulse'));
    const firstHitNodes = createdNodes.length - nodesBefore;

    player.triggerPreview(previewOf('pulse'));
    const secondHitNodes = createdNodes.length - nodesBefore - firstHitNodes;

    expect(secondHitNodes).toBe(firstHitNodes);
  });

  it('snare per-hit nodes are independent across triggers', async () => {
    await initSynthPlayer();
    const nodesBefore = createdNodes.length;
    player.triggerPreview(previewOf('groove'));
    const firstHitNodes = createdNodes.length - nodesBefore;

    player.triggerPreview(previewOf('groove'));
    const secondHitNodes = createdNodes.length - nodesBefore - firstHitNodes;

    expect(secondHitNodes).toBe(firstHitNodes);
  });

  it('polyphony cap evicts oldest hit nodes (kick)', async () => {
    await initSynthPlayer();
    // Trigger more than MAX_HITS (4) times
    for (let i = 0; i < 6; i++) {
      player.triggerPreview(previewOf('pulse'));
    }
    // Oldest hits should have been disposed — check for dispose() calls
    const disposedGains = createdNodes.filter(
      (n) => n.type === 'Gain' && n.node.dispose.mock.calls.length > 0,
    );
    expect(disposedGains.length).toBeGreaterThan(0);
  });

  it('polyphony cap evicts oldest hit nodes (cymbal)', async () => {
    await initSynthPlayer();
    for (let i = 0; i < 6; i++) {
      player.triggerPreview(previewOf('sparkle'));
    }
    const disposedGains = createdNodes.filter(
      (n) => n.type === 'Gain' && n.node.dispose.mock.calls.length > 0,
    );
    expect(disposedGains.length).toBeGreaterThan(0);
  });

  it('polyphony cap evicts oldest hit nodes (snare)', async () => {
    await initSynthPlayer();
    for (let i = 0; i < 6; i++) {
      player.triggerPreview(previewOf('groove'));
    }
    const disposedGains = createdNodes.filter(
      (n) => n.type === 'Gain' && n.node.dispose.mock.calls.length > 0,
    );
    expect(disposedGains.length).toBeGreaterThan(0);
  });

  it('dispose during active hits cleans up all per-hit nodes', async () => {
    await initSynthPlayer();
    // Trigger all voices to create per-hit nodes
    player.triggerPreview(previewOf('sparkle'));
    player.triggerPreview(previewOf('sparkle'));
    player.triggerPreview(previewOf('pulse'));
    player.triggerPreview(previewOf('groove'));

    // Count gains created by triggers (exclude init-time gains)
    const gainsBeforeDispose = createdNodes.filter(
      (n) => n.type === 'Gain' && n.node.dispose.mock.calls.length === 0,
    ).length;
    expect(gainsBeforeDispose).toBeGreaterThan(0);

    player.dispose();

    // All gains should be disposed now
    const undisposedGains = createdNodes.filter(
      (n) => n.type === 'Gain' && n.node.dispose.mock.calls.length === 0,
    );
    expect(undisposedGains.length).toBe(0);
  });

  it('mute/unmute works for synth voices', async () => {
    await initSynthPlayer();
    expect(() => {
      player.mute('pulse');
      player.unmute('pulse');
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Pad pan LFO
// ---------------------------------------------------------------------------

// Config with pad pan LFO enabled
const panLfoConfig: EngineConfig = configFromPreset({
  name: 'PanTest',
  tempo: 120,
  scale: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
  chordProgression: [
    { name: 'Am', root: 'A2', fifth: 'E2',
      padVoicing: ['A2', 'E3'], stabVoicing: ['A3', 'E4'] },
  ],
  kit: [
    { name: 'kick', shape: '▼', sample: '/samples/kick.wav', volumeDb: 0,
      color: { color: '#fff', glowColor: '#fff' } },
  ],
  pad: { shape: '≋', oscillator: 'fatsawtooth', spread: 30, count: 3,
    volumeDb: -21, filterLfoRange: [400, 1200], volumeLfoRange: [0.75, 1.0],
    panLfoRange: [-0.3, 0.3], panLfoRateMul: 0.5,
    attack: 0.3, release: 0.8 },
  bass: { shape: '∿', oscillator: 'triangle', filterCutoffHz: 500, volumeDb: 0 },
  stab: { shape: '⟁', oscillator: 'square', filterCutoffHz: 2000, volumeDb: -8,
    attack: 0.005, decay: 0.15, sustain: 0.05, release: 0.2,
    delayTime: '8n.', delayFeedback: 0.28, delayWet: 0.25 },
});

describe('Pad pan LFO', () => {
  it('creates a Panner when panLfoRange is configured', async () => {
    player = new Player();
    await player.init(panLfoConfig);
    const panners = findNodes('Panner');
    expect(panners.length).toBe(1);
  });

  it('creates a pan LFO connected to the panner', async () => {
    player = new Player();
    await player.init(panLfoConfig);
    const panners = findNodes('Panner');
    const lfos = findNodes('LFO');
    // Pan LFO should connect to panner.pan
    const panLfo = lfos.find((l) =>
      l.node.connect.mock.calls.some(
        (call: unknown[]) => call[0] === panners[0]?.node.pan,
      ),
    );
    expect(panLfo).toBeDefined();
  });

  it('no Panner when panLfoRange is omitted', async () => {
    player = new Player();
    await player.init(testConfig);
    const panners = findNodes('Panner');
    expect(panners.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Bass voice (per-hit architecture, filter envelope, portamento)
// ---------------------------------------------------------------------------

// Config with synthwave-style bass (filter envelope + glide)
const synthwaveBassConfig: EngineConfig = configFromPreset({
  name: 'BassTest',
  tempo: 120,
  scale: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
  chordProgression: [
    {
      name: 'Am', root: 'A2', fifth: 'E2',
      padVoicing: ['A2', 'E3'], stabVoicing: ['A3', 'E4'],
    },
  ],
  kit: [
    { name: 'pulse', shape: '▼', synthType: 'kick-sweep', volumeDb: 0,
      color: { color: '#fff', glowColor: '#fff' } },
  ],
  pad: { shape: '≋', oscillator: 'fatsawtooth', spread: 30, count: 3,
    volumeDb: -21, filterLfoRange: [400, 1200], volumeLfoRange: [0.75, 1.0],
    attack: 0.3, release: 0.8 },
  bass: {
    shape: '∿', oscillator: 'sawtooth', filterCutoffHz: 500, volumeDb: 0,
    filterEnvStart: 2000, filterEnvEnd: 300, filterEnvDecay: 0.15,
    glideTime: 0.05, saturationWet: 0.4,
  },
  stab: { shape: '⟁', oscillator: 'square', filterCutoffHz: 2000, volumeDb: -8,
    attack: 0.005, decay: 0.15, sustain: 0.05, release: 0.2,
    delayTime: '8n.', delayFeedback: 0.28, delayWet: 0.25 },
});

describe('Bass voice (per-hit architecture)', () => {
  async function initBassPlayer() {
    player = new Player();
    await player.init(synthwaveBassConfig);
    return player;
  }

  it('creates Oscillators and Filter per trigger (per-hit nodes)', async () => {
    await initBassPlayer();
    const oscsBefore = findNodes('Oscillator').length;
    const filtersBefore = findNodes('Filter').length;

    player.triggerPreview(previewOf('bass'));

    // Should create 2 oscillators (main + sub) and 1 per-hit filter
    expect(findNodes('Oscillator').length - oscsBefore).toBe(2);
    expect(findNodes('Filter').length - filtersBefore).toBe(1);
  });

  it('per-hit nodes are independent across triggers', async () => {
    await initBassPlayer();
    const nodesBefore = createdNodes.length;
    player.triggerPreview(previewOf('bass'));
    const firstHitNodes = createdNodes.length - nodesBefore;

    player.triggerPreview(previewOf('bass'));
    const secondHitNodes = createdNodes.length - nodesBefore - firstHitNodes;

    expect(secondHitNodes).toBe(firstHitNodes);
  });

  it('polyphony cap evicts oldest hit nodes', async () => {
    await initBassPlayer();
    for (let i = 0; i < 6; i++) {
      player.triggerPreview(previewOf('bass'));
    }
    const disposedGains = createdNodes.filter(
      (n) => n.type === 'Gain' && n.node.dispose.mock.calls.length > 0,
    );
    expect(disposedGains.length).toBeGreaterThan(0);
  });

  it('filter envelope schedules frequency ramp on per-hit filter', async () => {
    await initBassPlayer();
    player.triggerPreview(previewOf('bass'));

    // Find the per-hit filter (not the static filter created at init)
    const filters = findNodes('Filter');
    // Last filter created should be the per-hit envelope filter
    const hitFilter = filters[filters.length - 1].node;

    expect(hitFilter.frequency.setValueAtTime).toHaveBeenCalledWith(2000, expect.any(Number));
    expect(hitFilter.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      300, expect.any(Number),
    );
  });

  it('amplitude envelope schedules gain ramps', async () => {
    await initBassPlayer();
    const gainsBefore = findNodes('Gain').length;

    player.triggerPreview(previewOf('bass'));

    // Find gains created during trigger (per-hit nodes)
    const newGains = findNodes('Gain').slice(gainsBefore);
    // hitGain starts at 0 (silent) then ramps up — find the one with
    // a linearRampToValueAtTime call (the attack ramp)
    const hitGain = newGains.find(
      (g) => g.node.gain.linearRampToValueAtTime.mock.calls.length > 0,
    );

    expect(hitGain).toBeDefined();
    // Attack: linear ramp 0 → vGain
    expect(hitGain!.node.gain.linearRampToValueAtTime).toHaveBeenCalled();
    // Starts at 0
    expect(hitGain!.node.gain.setValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
  });

  it('portamento schedules frequency ramp on consecutive triggers', async () => {
    await initBassPlayer();
    // Use play() with note to test portamento (triggerPreview has no note)
    player.play(
      [{ sound: 'bass', velocity: 0.6, beatOffset: 0, note: 'A2', row: 0, col: 0, value: 1 as const }],
      0,
    );
    player.play(
      [{ sound: 'bass', velocity: 0.6, beatOffset: 0, note: 'C3', row: 0, col: 0, value: 1 as const }],
      0.1, // within 500ms → should glide
    );

    // The second trigger's oscillator should have setValueAtTime (prev freq)
    // followed by exponentialRampToValueAtTime (new freq)
    const oscs = findNodes('Oscillator');
    // Last two oscs are the second trigger's main + sub
    const secondMainOsc = oscs[oscs.length - 2].node;
    expect(secondMainOsc.frequency.setValueAtTime).toHaveBeenCalled();
    expect(secondMainOsc.frequency.exponentialRampToValueAtTime).toHaveBeenCalled();
  });

  it('no per-hit filter when filterEnvStart is omitted (debug preset)', async () => {
    // synthConfig uses the debug bass (no envelope params)
    player = new Player();
    await player.init(synthConfig);

    const filtersBefore = findNodes('Filter').length;
    player.triggerPreview(previewOf('bass'));

    // No additional filter created per trigger
    expect(findNodes('Filter').length).toBe(filtersBefore);
  });

  it('dispose cleans up bass per-hit and shared nodes', async () => {
    await initBassPlayer();
    player.triggerPreview(previewOf('bass'));
    player.triggerPreview(previewOf('bass'));

    player.dispose();

    const undisposedGains = createdNodes.filter(
      (n) => n.type === 'Gain' && n.node.dispose.mock.calls.length === 0,
    );
    expect(undisposedGains.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Bass chorus
// ---------------------------------------------------------------------------

describe('Bass chorus', () => {
  const chorusBassConfig: EngineConfig = configFromPreset({
    name: 'ChorusTest',
    tempo: 120,
    scale: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
    chordProgression: [
      { name: 'Am', root: 'A2', fifth: 'E2',
        padVoicing: ['A2', 'E3'], stabVoicing: ['A3', 'E4'] },
    ],
    kit: [
      { name: 'pulse', shape: '▼', synthType: 'kick-sweep', volumeDb: 0,
        color: { color: '#fff', glowColor: '#fff' } },
    ],
    pad: { shape: '≋', oscillator: 'fatsawtooth', spread: 30, count: 3,
      volumeDb: -21, filterLfoRange: [400, 1200], volumeLfoRange: [0.75, 1.0],
      attack: 0.3, release: 0.8 },
    bass: {
      shape: '∿', oscillator: 'sawtooth', filterCutoffHz: 500, volumeDb: 0,
      filterEnvStart: 2000, filterEnvEnd: 300, filterEnvDecay: 0.15,
      chorusDelayMs: 3, chorusRate: 0.5, chorusWet: 0.2,
    },
    stab: { shape: '⟁', oscillator: 'square', filterCutoffHz: 2000, volumeDb: -8,
      attack: 0.005, decay: 0.15, sustain: 0.05, release: 0.2,
      delayTime: '8n.', delayFeedback: 0.28, delayWet: 0.25 },
  });

  it('creates a Chorus node when chorusDelayMs is configured', async () => {
    player = new Player();
    await player.init(chorusBassConfig);

    const choruses = findNodes('Chorus');
    expect(choruses.length).toBe(1);
  });

  it('Chorus connects to saturation (Chebyshev)', async () => {
    player = new Player();
    await player.init(chorusBassConfig);

    const chorusNode = findNodes('Chorus')[0].node;
    const chebyshevNode = findNodes('Chebyshev')[0].node;
    // Chorus should connect to saturation
    expect(chorusNode.connect).toHaveBeenCalledWith(chebyshevNode);
  });

  it('per-hit main gain connects to Chorus (not direct to saturation)', async () => {
    player = new Player();
    await player.init(chorusBassConfig);

    const chorusNode = findNodes('Chorus')[0].node;
    player.triggerPreview(previewOf('bass'));

    // Find gains created after init — per-hit gains
    const gains = findNodes('Gain');
    const perHitGains = gains.filter(
      (g) => g.node.connect.mock.calls.some(
        (call: unknown[]) => call[0] === chorusNode,
      ),
    );
    expect(perHitGains.length).toBeGreaterThan(0);
  });

  it('no Chorus when chorusDelayMs is omitted', async () => {
    player = new Player();
    await player.init(synthwaveBassConfig); // no chorus config

    const choruses = findNodes('Chorus');
    expect(choruses.length).toBe(0);
  });

  it('dispose cleans up Chorus node', async () => {
    player = new Player();
    await player.init(chorusBassConfig);

    player.dispose();

    const choruses = findNodes('Chorus');
    expect(choruses[0].node.dispose).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Pad chord crossfade and top-note drift
// ---------------------------------------------------------------------------

describe('Pad chord crossfade and top-note drift', () => {
  async function initPadPlayer() {
    player = new Player();
    await player.init(synthConfig);
    player.startPad();
    // Find the PolySynth created during this init (last one in the list)
    const polySynths = findNodes('PolySynth');
    return polySynths[polySynths.length - 1].node;
  }

  it('changePadChord uses triggerRelease (not releaseAll) for crossfade', async () => {
    const synth = await initPadPlayer();

    player.changePadChord(['A2', 'E3', 'B3']);
    player.changePadChord(['F2', 'C3', 'G3']);

    expect(synth.triggerRelease).toHaveBeenCalledWith(
      ['A2', 'E3', 'B3'],
      expect.anything(),
    );
    expect(synth.triggerAttack).toHaveBeenCalledWith(
      ['F2', 'C3', 'G3'],
      expect.anything(),
    );
  });

  it('shiftPadTopNote releases old note and attacks new note', async () => {
    const synth = await initPadPlayer();

    player.changePadChord(['A2', 'E3', 'B3']);
    synth.triggerRelease.mockClear();
    synth.triggerAttack.mockClear();

    player.shiftPadTopNote('B3', 'C4');

    expect(synth.triggerRelease).toHaveBeenCalledWith(
      ['B3'],
      expect.anything(),
    );
    expect(synth.triggerAttack).toHaveBeenCalledWith(
      ['C4'],
      expect.anything(),
    );
  });

  it('shiftPadTopNote does nothing if old note is not in current voicing', async () => {
    const synth = await initPadPlayer();

    player.changePadChord(['A2', 'E3', 'B3']);
    synth.triggerRelease.mockClear();
    synth.triggerAttack.mockClear();

    player.shiftPadTopNote('D4', 'C4'); // D4 not in voicing

    expect(synth.triggerRelease).not.toHaveBeenCalled();
    expect(synth.triggerAttack).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Per-voice mix LFOs
// ---------------------------------------------------------------------------

describe('Per-voice mix LFOs', () => {
  it('creates LFOs for voices with mixLfo config', async () => {
    const mixLfoConfig: EngineConfig = configFromPreset({
      name: 'MixLfoTest',
      tempo: 120,
      scale: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
      chordProgression: [
        { name: 'Am', root: 'A2', fifth: 'E2',
          padVoicing: ['A2', 'E3'], stabVoicing: ['A3', 'E4'] },
      ],
      kit: [
        { name: 'hat', shape: '∙', synthType: 'synth-hat', volumeDb: 6,
          color: { color: '#fff', glowColor: '#fff' },
          mixLfo: { min: 0.7, max: 1.0, rateInLoops: 5 } },
        { name: 'kick', shape: '▼', synthType: 'kick-sweep', volumeDb: 0,
          color: { color: '#fff', glowColor: '#fff' } }, // no mixLfo
      ],
      pad: { shape: '≋', oscillator: 'fatsawtooth', spread: 30, count: 3,
        volumeDb: -21, filterLfoRange: [400, 1200], volumeLfoRange: [0.75, 1.0],
        attack: 0.3, release: 0.8 },
      bass: { shape: '∿', oscillator: 'triangle', filterCutoffHz: 500, volumeDb: 0,
        mixLfo: { min: 0.8, max: 1.0, rateInLoops: 4 } },
      stab: { shape: '⟁', oscillator: 'square', filterCutoffHz: 2000, volumeDb: -8,
        attack: 0.005, decay: 0.15, sustain: 0.05, release: 0.2,
        delayTime: '8n.', delayFeedback: 0.28, delayWet: 0.25 },
    });

    player = new Player();
    const lfosBefore = findNodes('LFO').length;
    await player.init(mixLfoConfig);

    // Should create 2 mix LFOs (hat + bass) + 2 pad LFOs (filter + volume) = 4
    const newLfos = findNodes('LFO').length - lfosBefore;
    expect(newLfos).toBe(4);
  });

  it('no mix LFOs when no mixLfo configs present', async () => {
    player = new Player();
    const lfosBefore = findNodes('LFO').length;
    await player.init(synthConfig); // debug config, no mixLfo

    // Only pad LFOs (filter + volume), no mix LFOs
    const padLfoCount = 2; // filter LFO + volume LFO
    const newLfos = findNodes('LFO').length - lfosBefore;
    expect(newLfos).toBe(padLfoCount);
  });

  it('dispose cleans up mix LFOs', async () => {
    const mixLfoConfig: EngineConfig = configFromPreset({
      name: 'MixLfoDispose',
      tempo: 120,
      scale: ['C'],
      chordProgression: [
        { name: 'C', root: 'C2', fifth: 'G2',
          padVoicing: ['C2', 'G2'], stabVoicing: ['C3', 'G3'] },
      ],
      kit: [
        { name: 'kick', shape: '▼', synthType: 'kick-sweep', volumeDb: 0,
          color: { color: '#fff', glowColor: '#fff' },
          mixLfo: { min: 0.8, max: 1.0, rateInLoops: 3 } },
      ],
      pad: { shape: '≋', oscillator: 'fatsawtooth', spread: 30, count: 3,
        volumeDb: -21, filterLfoRange: [400, 1200], volumeLfoRange: [0.75, 1.0],
        attack: 0.3, release: 0.8 },
      bass: { shape: '∿', oscillator: 'triangle', filterCutoffHz: 500, volumeDb: 0 },
      stab: { shape: '⟁', oscillator: 'square', filterCutoffHz: 2000, volumeDb: -8,
        attack: 0.005, decay: 0.15, sustain: 0.05, release: 0.2 },
    });

    player = new Player();
    await player.init(mixLfoConfig);
    player.dispose();

    const undisposedLfos = findNodes('LFO').filter(
      (n) => n.node.dispose.mock.calls.length === 0,
    );
    expect(undisposedLfos.length).toBe(0);
  });
});

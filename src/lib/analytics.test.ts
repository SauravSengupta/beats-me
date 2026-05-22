// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock posthog-js before importing analytics
vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
  },
}));

// Set PROD to true and provide a key so analytics initializes
import.meta.env.PROD = true as never;
(import.meta.env as { VITE_POSTHOG_KEY?: string }).VITE_POSTHOG_KEY = 'phc_test';

// Must import after mocks and env are set up
import posthog from 'posthog-js';

// Re-import analytics fresh for each test to reset `initialized` state
let initAnalytics: typeof import('./analytics').initAnalytics;
let trackPlayStart: typeof import('./analytics').trackPlayStart;
let trackPlayComplete: typeof import('./analytics').trackPlayComplete;
let trackShareClick: typeof import('./analytics').trackShareClick;
let trackDiceRoll: typeof import('./analytics').trackDiceRoll;
let trackModeChange: typeof import('./analytics').trackModeChange;

beforeEach(async () => {
  vi.clearAllMocks();
  // Reset the module so `initialized` is false for each test
  vi.resetModules();
  // Re-mock posthog after resetModules
  vi.doMock('posthog-js', () => ({
    default: posthog,
  }));
  const mod = await import('./analytics');
  initAnalytics = mod.initAnalytics;
  trackPlayStart = mod.trackPlayStart;
  trackPlayComplete = mod.trackPlayComplete;
  trackShareClick = mod.trackShareClick;
  trackDiceRoll = mod.trackDiceRoll;
  trackModeChange = mod.trackModeChange;
});

describe('analytics', () => {
  it('initializes posthog with cookieless config', () => {
    initAnalytics(false);

    expect(posthog.init).toHaveBeenCalledOnce();
    const [key, options] = (posthog.init as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(key).toMatch(/^phc_/);
    expect(options.persistence).toBe('memory');
    expect(options.autocapture).toBe(false);
    expect(options.capture_pageview).toBe(false);
  });

  it('fires page_load with source direct on init', () => {
    initAnalytics(false);

    expect(posthog.capture).toHaveBeenCalledWith('page_load', { source: 'direct' });
  });

  it('fires page_load with source shared when isSharedLoad is true', () => {
    initAnalytics(true);

    expect(posthog.capture).toHaveBeenCalledWith('page_load', { source: 'shared' });
  });

  it('trackPlayStart fires play_start event', () => {
    initAnalytics(false);
    vi.mocked(posthog.capture).mockClear();

    trackPlayStart();
    expect(posthog.capture).toHaveBeenCalledWith('play_start');
  });

  it('trackPlayComplete fires play_complete event', () => {
    initAnalytics(false);
    vi.mocked(posthog.capture).mockClear();

    trackPlayComplete();
    expect(posthog.capture).toHaveBeenCalledWith('play_complete');
  });

  it('trackShareClick fires share_click event', () => {
    initAnalytics(false);
    vi.mocked(posthog.capture).mockClear();

    trackShareClick();
    expect(posthog.capture).toHaveBeenCalledWith('share_click');
  });

  it('trackDiceRoll fires dice_roll event with variation', () => {
    initAnalytics(false);
    vi.mocked(posthog.capture).mockClear();

    trackDiceRoll(7);
    expect(posthog.capture).toHaveBeenCalledWith('dice_roll', { variation: 7 });
  });

  it('trackModeChange fires mode_change event with mode', () => {
    initAnalytics(false);
    vi.mocked(posthog.capture).mockClear();

    trackModeChange('loop');
    expect(posthog.capture).toHaveBeenCalledWith('mode_change', { mode: 'loop' });
  });

  it('does not fire events before init', async () => {
    // Fresh module, no init called
    trackPlayStart();
    trackPlayComplete();
    trackShareClick();
    trackDiceRoll(3);
    trackModeChange('short');
    expect(posthog.capture).not.toHaveBeenCalled();
  });
});

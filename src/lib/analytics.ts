import posthog from 'posthog-js';

// ---------------------------------------------------------------------------
// Analytics — PostHog (cookieless, prod-only)
// ---------------------------------------------------------------------------
//
// 6 events:
//   page_load       — arrived (source: 'shared' | 'direct')
//   play_start      — first play of session
//   play_complete   — arrangement finished (full song heard)
//   share_click     — copied a share URL
//   dice_roll       — variation seed re-rolled (variation: 0-15)
//   mode_change     — playback mode cycled (mode: 'short' | 'long' | 'loop')
//   session_engaged — 30s of visible tab time (fired once)
//   session_end     — page unload with time_spent_seconds
//

// Optional — analytics stay off unless a key is provided (see .env.example).
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;

let initialized = false;
let sessionStartTime = 0;
let hasTrackedEngaged = false;
let engagedTimer: ReturnType<typeof setTimeout> | undefined;

export function initAnalytics(isSharedLoad: boolean): void {
  if (!import.meta.env.PROD || !POSTHOG_KEY) return;

  posthog.init(POSTHOG_KEY, {
    api_host: 'https://us.i.posthog.com',
    persistence: 'memory',          // cookieless — no localStorage, no cookies
    autocapture: false,             // manual events only
    capture_pageview: false,        // we fire our own
    capture_pageleave: false,       // we fire session_end ourselves
    disable_session_recording: true,
  });

  initialized = true;
  sessionStartTime = Date.now();

  posthog.capture('page_load', {
    source: isSharedLoad ? 'shared' : 'direct',
  });

  // Session engaged — 30s of visible tab
  startEngagedTimer();
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Session end — page unload
  window.addEventListener('beforeunload', onBeforeUnload);
}

function startEngagedTimer(): void {
  if (hasTrackedEngaged || !initialized) return;
  engagedTimer = setTimeout(() => {
    if (!hasTrackedEngaged) {
      hasTrackedEngaged = true;
      posthog.capture('session_engaged');
    }
  }, 30_000);
}

function onVisibilityChange(): void {
  if (document.hidden) {
    // Pause the engaged timer when tab is hidden
    clearTimeout(engagedTimer);
  } else {
    // Resume when visible
    startEngagedTimer();
  }
}

function onBeforeUnload(): void {
  if (!initialized) return;
  const seconds = Math.round((Date.now() - sessionStartTime) / 1000);
  posthog.capture('session_end', { time_spent_seconds: seconds });
}

export function trackPlayStart(): void {
  if (!initialized) return;
  posthog.capture('play_start');
}

export function trackPlayComplete(): void {
  if (!initialized) return;
  posthog.capture('play_complete');
}

export function trackShareClick(): void {
  if (!initialized) return;
  posthog.capture('share_click');
}

export function trackDiceRoll(variation: number): void {
  if (!initialized) return;
  posthog.capture('dice_roll', { variation });
}

export function trackModeChange(mode: string): void {
  if (!initialized) return;
  posthog.capture('mode_change', { mode });
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** PostHog project API key (client-side, write-only). Optional — analytics off when unset. */
  readonly VITE_POSTHOG_KEY?: string;
  /** Sentry DSN (client-side, write-only). Optional — error reporting off when unset. */
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

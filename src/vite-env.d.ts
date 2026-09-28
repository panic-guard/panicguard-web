/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the deployed Gemini/Cloud Run proxy (server/). Unset in
   * local/dev builds — the app falls back to static templates when so. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

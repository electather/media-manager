/// <reference types="vite-plus/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
  readonly VITE_SHARED_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

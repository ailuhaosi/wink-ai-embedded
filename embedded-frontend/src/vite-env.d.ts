/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LEGACY_WIRE_ROUTING: string;
  readonly VITE_MANIFEST_SCHEMA_V2: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

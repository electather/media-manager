/// <reference types="vite-plus/client" />

declare module "*.po" {
  import type { Messages } from "@lingui/core";
  export const messages: Messages;
}

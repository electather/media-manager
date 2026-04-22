import type { ConnectionStatus } from "./enums";

/** Row returned by `GET /api/connections`. Plugin metadata is joined in. */
export interface ConnectionListItem {
  id: string;
  pluginId: string;
  status: ConnectionStatus;
  enabled: boolean;
  isDefault: boolean;
  displayName: string | null;
  tokenExpiresAt: number | null;
  lastVerifiedAt: number | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  /** Non-secret user-supplied config. Null when none was stored. */
  userConfig: unknown;
  plugin: ConnectionPluginSummary;
}

export interface ConnectionPluginSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  auth: string;
  enabled: boolean;
  logoUrl?: string;
  capabilities: string[];
  userConfigSchema: unknown;
}

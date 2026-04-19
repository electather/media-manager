export interface ConnectionListItem {
  id: string;
  pluginId: string;
  status: string;
  enabled: boolean;
  isDefault: boolean;
  displayName: string | null;
  tokenExpiresAt: number | null;
  lastVerifiedAt: number | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  /** Non-secret user-supplied config (e.g. Seerr's baseUrl). Null when none was stored. */
  userConfig: unknown;
  plugin: {
    id: string;
    name: string;
    version: string;
    description: string;
    auth: string;
    enabled: boolean;
    logoUrl?: string;
    capabilities: string[];
    userConfigSchema: unknown;
  };
}

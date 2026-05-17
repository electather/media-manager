import type { PluginContext } from "@ent-mcp/plugin-sdk";

export interface PlexCreds {
  /** Plex auth token (X-Plex-Token). */
  authToken: string;
}

export interface PlexUserCfg {
  /** Identifier of the Plex server the user selected at auth time. */
  machineIdentifier: string;
  /** Public URL used for playerLink/webLink. MUST be reachable from the caller. */
  externalServerUrl: string;
  /** Optional internal URL used by the host for server-to-server fetches. */
  internalServerUrl?: string;
  /** Server-local Plex account id cached at auth time for session filtering. */
  plexAccountId?: string;
}

export interface PlexGlobalCfg {}

export interface PlexSharedCreds {}

export type Ctx = PluginContext<PlexCreds, PlexSharedCreds, PlexUserCfg, PlexGlobalCfg>;

export interface PlexMediaContainer<T> {
  MediaContainer: T;
}

export interface PlexGuid {
  id: string;
}

export interface PlexPart {
  id: number;
  size?: number;
  container?: string;
  file?: string;
}

export interface PlexMedia {
  id?: number;
  videoResolution?: string;
  videoCodec?: string;
  bitrate?: number;
  videoDynamicRange?: string;
  Part?: PlexPart[];
}

export interface PlexMetadata {
  ratingKey: string;
  key: string;
  type: string;
  title: string;
  grandparentTitle?: string;
  parentIndex?: number;
  index?: number;
  librarySectionID?: number;
  Media?: PlexMedia[];
  Guid?: PlexGuid[];
  duration?: number;
  viewOffset?: number;
  addedAt?: number;
  lastViewedAt?: number;
  viewCount?: number;
  User?: { id: string; title?: string };
}

export interface PlexDirectory {
  key: string;
  title: string;
  type: string;
}

export interface PlexSession extends PlexMetadata {
  sessionKey?: string;
  Session?: { id: string };
  Player?: {
    title?: string;
    product?: string;
    state?: string;
  };
  User: { id: string; title?: string };
  TranscodeSession?: {
    videoDecision?: string;
    audioDecision?: string;
    targetBitrate?: number;
    transcodeReason?: string;
    throttled?: boolean;
  };
}

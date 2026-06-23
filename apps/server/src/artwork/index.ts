/**
 * Public barrel for artwork/. Boundaries test asserts re-exports come only from
 * approved siblings (service, events, jobs). Per-item failures ride back on RPC
 * response's errors map as plain data (ArtworkError); no typed error exported.
 */
export { ArtworkService } from "./service";
export { ARTWORK_EVENTS } from "./events";
export { registerJobs } from "./jobs";

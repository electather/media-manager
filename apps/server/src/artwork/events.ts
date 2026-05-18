/**
 * Cross-module events emitted by `artwork/`. Empty in Phase 3c — artwork
 * dispatches plugins synchronously and writes back via CatalogService. Future
 * events such as `artwork.resolved` will be declared here once a downstream
 * module needs to react to them.
 */
export const ARTWORK_EVENTS = {} as const;

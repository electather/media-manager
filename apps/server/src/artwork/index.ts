/**
 * Public barrel for `artwork/`. Boundaries test asserts re-exports come only
 * from approved sibling files such as `./service`, `./events`, and `./jobs`.
 * Per-item failures ride back on the RPC response's `errors` map as plain data
 * (`ArtworkError`), so the module throws no typed error and exposes none here.
 */
export { ArtworkService } from "./service";
export { ARTWORK_EVENTS } from "./events";
export { registerJobs } from "./jobs";

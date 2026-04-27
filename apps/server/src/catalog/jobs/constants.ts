/**
 * Sentinel user id used by jobs that drive global-scope plugin
 * capabilities (e.g. `metadata@v1`). The dispatcher routes via admin-pool
 * credentials regardless of this value; the constant exists so the
 * sentinel is searchable and consistent across job entry points.
 */
export const SYSTEM_USER_ID = "__system__";

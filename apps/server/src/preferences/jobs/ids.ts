/**
 * Job IDs the preference engine owns. Centralised in a leaf module so the
 * job-registration files, the service surface (`triggerManualRebuild`,
 * `isManualRebuildRunning`, etc.), and any future callers all share one
 * source of truth. Renaming one of these strings now updates every site in
 * lock-step.
 */
export const PREFERENCE_DAILY_JOB_ID = "host.preference.daily_rebuild";
export const PREFERENCE_INCREMENTAL_JOB_ID = "host.preference.incremental_update";
export const PREFERENCE_MANUAL_REBUILD_JOB_ID = "feature.preference.rebuild";

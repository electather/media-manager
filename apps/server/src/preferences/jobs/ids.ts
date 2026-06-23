/** Job IDs the preference engine owns. Centralized here so job-registration files, service surface (triggerManualRebuild, isManualRebuildRunning, etc.), and future callers share one source of truth. */
export const PREFERENCE_DAILY_JOB_ID = "host.preference.daily_rebuild";
export const PREFERENCE_INCREMENTAL_JOB_ID = "host.preference.incremental_update";
export const PREFERENCE_MANUAL_REBUILD_JOB_ID = "feature.preference.rebuild";

// MIRROR of packages/shared/src/types.ts — keep in sync.
//
// apps/api cannot import @adyton/shared from source: tsc resolves the workspace
// path mapping to packages/shared/src, which lives outside api's rootDir (TS6059),
// and shared has no built dist yet (deferred to Phase 8). These are plaintext,
// non-secret UI preferences, so a local mirror is safe.

export type LockMode = 'activity' | 'absolute';

export interface UserSettings {
  displayName: string;
  lockMode: LockMode;
  lockDurationMs: number; // 0 = never auto-lock, otherwise LOCK_DURATION_MIN_MS..LOCK_DURATION_MAX_MS
}

export const LOCK_DURATION_MIN_MS = 60_000; // 1 min
export const LOCK_DURATION_MAX_MS = 3_600_000; // 60 min

export const DEFAULT_USER_SETTINGS: Readonly<UserSettings> = Object.freeze({
  displayName: '',
  lockMode: 'activity',
  lockDurationMs: 15 * 60_000,
});

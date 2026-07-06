import { ApiError } from '../errors';

/**
 * Throw `ApiError.versionConflict()` (409) when the client-supplied
 * `expectedVersion` does not match the current persisted `currentVersion`.
 */
export function checkVersion(
  expectedVersion: number,
  currentVersion: number,
): void {
  if (expectedVersion !== currentVersion) {
    throw ApiError.versionConflict();
  }
}

/**
 * Higher-order helper: verify the version, then run `updateFn` which performs
 * the mutation (including the version increment).
 */
export async function withVersionCheck<T>(
  expectedVersion: number,
  currentVersion: number,
  updateFn: () => Promise<T>,
): Promise<T> {
  checkVersion(expectedVersion, currentVersion);
  return updateFn();
}

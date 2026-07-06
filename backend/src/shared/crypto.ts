import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-SHA256 digest of `value` keyed with `pepper`.
 *
 * Used to derive non-reversible stored digests (e.g. guest session keys,
 * idempotency-key hashes) so the raw secret never persists.
 */
export function hmacDigest(pepper: string, value: string): string {
  return createHmac('sha256', pepper).update(value).digest('hex');
}

/**
 * Constant-time comparison of two strings.
 *
 * Returns `false` (without throwing) when lengths differ; for fixed-length
 * digests the common case is equal length so the comparison is fully
 * constant-time.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

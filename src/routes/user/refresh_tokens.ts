/*
 * Simple in-memory store for refresh tokens.
 */
import { randomBytes } from 'node:crypto';

export type RefreshTokenRecord = {
  tokenId: string;
  sub: string;
  id: number;
  role: string;
  familyId: string;
  revoked: boolean;
  expiresAt: number;
};

const refreshTokens = new Map<string, RefreshTokenRecord>();
const refreshTokensByFamily: Record<string, RefreshTokenRecord[]> = {};

function randomId(size = 16): string {
  return randomBytes(size).toString('hex');
}

/*
 * Register a refresh token
 */
export function registerRefreshTokenRecord(
  sub: string,
  id: number,
  role: string,
  ttlSeconds: number,
  familyId?: string,
): RefreshTokenRecord {
  const tokenId = randomId();
  const record: RefreshTokenRecord = {
    tokenId,
    sub,
    id,
    role,
    familyId: familyId ?? tokenId,
    revoked: false,
    expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  refreshTokens.set(tokenId, record);
  (refreshTokensByFamily[record.familyId] ??= []).push(record);
  return record;
}

/*
 * Look up a refresh token record by token id
 */
export function lookupRefreshTokenRecord(
  tokenId: string,
): RefreshTokenRecord | undefined {
  return refreshTokens.get(tokenId);
}

/*
 * Mark a refresh token as revoked (for instance, after it was used.)
 */
export function revokeRefreshTokenRecord(tokenId: string): void {
  const record = refreshTokens.get(tokenId);
  if (record) record.revoked = true;
}

/*
 * Invoke all refresh tokens of a family - a countermeasure
 * taken when an attempt at reusing a refresh token from that family
 * is detected.
 *
 * Returns the number of revoked tokens.
 */
export function revokeTokenFamilyRecords(familyId: string): number {
  let count = 0;
  for (const record of refreshTokensByFamily[familyId] ?? []) {
    if (!record.revoked) {
      record.revoked = true;
      count++;
    }
  }
  return count;
}

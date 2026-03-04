/**
 * Refresh-token rotation, reuse detection, and access-token expiration tests.
 *
 * Bootstrap: clear the DB via UserDBFactory before building the app.
 * No admin user is needed; all users are created via POST /user.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildTestApp } from '../../vitest-helper.js';
import UserDBFactory from '../../../src/lib/csvuserdatabase.js';
import { config } from '../../../src/config.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let userCounter = 0;
const USER_PREFIX = `${config.routes.api_prefix.replace(/\/$/, '')}${config.routes.user_prefix}`;

beforeAll(async () => {
  const db = await UserDBFactory(config.db.filename);
  await db.clear();

  app = await buildTestApp({ cookies: true });
});

afterAll(async () => {
  vi.useRealTimers(); // safety net in case a test forgot to restore
  await app.close();
});

/**
 * Creates a fresh user via POST /user and returns the auto-login tokens.
 * Each call uses a unique username so tests are independent.
 */
async function createUserAndLogin(): Promise<{
  accessToken: string;
  refreshToken: string;
  accessExpiresInSec: number;
  userId: number;
}> {
  const n = ++userCounter;
  const res = await app.inject({
    method: 'POST',
    url: USER_PREFIX,
    payload: {
      username: `tokenuser${n}`,
      password: 'tokenpassword123',
      fullname: `Token Test User ${n}`,
    },
  });
  const body = res.json();
  const cookie = res.cookies.find((c) => c.name === 'refresh_token')!;
  const location = res.headers['location'] as string;
  return {
    accessToken: body.accessToken,
    refreshToken: cookie.value,
    accessExpiresInSec: body.accessExpiresInSec,
    userId: parseInt(location.split('/').pop()!),
  };
}

// ---------------------------------------------------------------------------
// POST /user/refresh — basic rotation
// ---------------------------------------------------------------------------

describe('POST /user/refresh', () => {
  it('returns 200 with new accessToken, rotated: true, and a new refresh_token cookie', async () => {
    const { refreshToken } = await createUserAndLogin();

    const res = await app.inject({
      method: 'POST',
      url: `${USER_PREFIX}/refresh`,
      cookies: { refresh_token: refreshToken },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('accessToken');
    expect(typeof body.accessToken).toBe('string');
    expect(body.rotated).toBe(true);

    const newCookie = res.cookies.find((c) => c.name === 'refresh_token');
    expect(newCookie).toBeDefined();
    expect(newCookie?.value).not.toBe(refreshToken); // new token issued
  });

  it('rejects reuse of the old refresh token after rotation (401)', async () => {
    const { refreshToken: oldToken } = await createUserAndLogin();

    // First refresh: valid rotation.
    const firstRes = await app.inject({
      method: 'POST',
      url: `${USER_PREFIX}/refresh`,
      cookies: { refresh_token: oldToken },
    });
    expect(firstRes.statusCode).toBe(200);

    // Replay old token — must be rejected.
    const replayRes = await app.inject({
      method: 'POST',
      url: `${USER_PREFIX}/refresh`,
      cookies: { refresh_token: oldToken },
    });
    expect(replayRes.statusCode).toBe(401);
  });

  it('returns 401 with no cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${USER_PREFIX}/refresh`,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().detail).toMatch(/missing refresh cookie/i);
  });

  it('returns 401 for a tampered / invalid JWT in the cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${USER_PREFIX}/refresh`,
      cookies: { refresh_token: 'not.a.valid.jwt' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('reuse detection revokes the entire token family; the rotated token also fails', async () => {
    const { refreshToken: rt1 } = await createUserAndLogin();

    // Rotate RT1 → RT2.
    const rotateRes = await app.inject({
      method: 'POST',
      url: `${USER_PREFIX}/refresh`,
      cookies: { refresh_token: rt1 },
    });
    expect(rotateRes.statusCode).toBe(200);
    const rt2 = rotateRes.cookies.find(
      (c) => c.name === 'refresh_token',
    )!.value;

    // Replay RT1 → triggers family revocation, error message must indicate reuse.
    const reuseRes = await app.inject({
      method: 'POST',
      url: `${USER_PREFIX}/refresh`,
      cookies: { refresh_token: rt1 },
    });
    expect(reuseRes.statusCode).toBe(401);
    expect(reuseRes.json().detail).toMatch(/refresh token reuse detected/i);

    // RT2 is in the same family → must also be rejected.
    const rt2Res = await app.inject({
      method: 'POST',
      url: `${USER_PREFIX}/refresh`,
      cookies: { refresh_token: rt2 },
    });
    expect(rt2Res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Access token expiration — uses fake timers to advance the clock
// ---------------------------------------------------------------------------

describe('Access token expiration', () => {
  let accessToken: string;
  let userId: number;
  let accessExpiresInSec: number;

  beforeAll(async () => {
    // Freeze Date.now() at the current real time so we control when the
    // clock advances.  Tokens signed while fake timers are active carry an
    // `exp` based on the frozen time.
    vi.useFakeTimers({ toFake: ['Date'] });

    const data = await createUserAndLogin();
    accessToken = data.accessToken;
    userId = data.userId;
    accessExpiresInSec = data.accessExpiresInSec;
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('access token works on a protected endpoint before expiration', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${USER_PREFIX}/${userId}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('access token returns 401 after expiration', async () => {
    // Advance the fake clock past the token's exp claim.
    vi.setSystemTime(Date.now() + (accessExpiresInSec + 1) * 1000);

    const res = await app.inject({
      method: 'GET',
      url: `${USER_PREFIX}/${userId}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

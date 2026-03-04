/**
 * Auth flow tests: login, user-creation auto-login, token response structure,
 * and rejection of unauthenticated requests.
 *
 * Bootstrap: clear the DB via UserDBFactory before building the app so that
 * the route module's module-level `userdb` starts from an empty slate.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp } from '../../vitest-helper.js';
import UserDBFactory from '../../../src/lib/csvuserdatabase.js';
import { config } from '../../../src/config.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

const testUser = {
  username: 'authtest',
  password: 'testpassword123',
  fullname: 'Auth Test User',
};
const USER_PREFIX = `${config.routes.api_prefix.replace(/\/$/, '')}${config.routes.user_prefix}`;

beforeAll(async () => {
  // Clear the CSV before building so the route module starts with an empty DB.
  const db = await UserDBFactory(config.db.filename);
  await db.clear();

  app = await buildTestApp({ cookies: true });

  // Seed our test user via the API (adds to the live in-memory DB).
  await app.inject({
    method: 'POST',
    url: USER_PREFIX,
    payload: testUser,
  });
});

afterAll(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// POST /login
// ---------------------------------------------------------------------------

describe('POST /login with correct credentials', () => {
  it('returns 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${USER_PREFIX}/login`,
      payload: { username: testUser.username, password: testUser.password },
    });
    expect(res.statusCode).toBe(200);
  });

  it('response body has accessToken, accessExpiresInSec, refreshExpiresInSec, rotated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${USER_PREFIX}/login`,
      payload: { username: testUser.username, password: testUser.password },
    });
    const body = res.json();
    expect(body).toHaveProperty('accessToken');
    expect(typeof body.accessToken).toBe('string');
    expect(body).toHaveProperty('accessExpiresInSec');
    expect(typeof body.accessExpiresInSec).toBe('number');
    expect(body).toHaveProperty('refreshExpiresInSec');
    expect(typeof body.refreshExpiresInSec).toBe('number');
    expect(body).toHaveProperty('rotated');
  });

  it('sets a refresh_token cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${USER_PREFIX}/login`,
      payload: { username: testUser.username, password: testUser.password },
    });
    const cookie = res.cookies.find((c) => c.name === 'refresh_token');
    expect(cookie).toBeDefined();
    expect(cookie?.value).toBeTruthy();
  });
});

describe('POST /login with wrong password', () => {
  it('returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${USER_PREFIX}/login`,
      payload: { username: testUser.username, password: 'wrongpassword123' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /login with nonexistent username', () => {
  it('returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${USER_PREFIX}/login`,
      payload: { username: 'nosuchuser', password: 'wrongpassword123' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns the same error message as a wrong-password attempt (no username enumeration)', async () => {
    const wrongPwdRes = await app.inject({
      method: 'POST',
      url: `${USER_PREFIX}/login`,
      payload: { username: testUser.username, password: 'wrongpassword123' },
    });
    const noUserRes = await app.inject({
      method: 'POST',
      url: `${USER_PREFIX}/login`,
      payload: { username: 'nosuchuser', password: 'wrongpassword123' },
    });
    expect(noUserRes.json().detail).toBe(wrongPwdRes.json().detail);
  });
});

// ---------------------------------------------------------------------------
// POST /user (create) — auto-login after account creation
// ---------------------------------------------------------------------------

describe('POST /user (create)', () => {
  it('returns 201 with accessToken and a refresh_token cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: USER_PREFIX,
      payload: {
        username: 'newcreatetest',
        password: 'testpassword123',
        fullname: 'New Create Test',
      },
    });
    expect(res.statusCode).toBe(201);

    const body = res.json();
    expect(body).toHaveProperty('accessToken');
    expect(typeof body.accessToken).toBe('string');
    expect(body).toHaveProperty('accessExpiresInSec');
    expect(body).toHaveProperty('refreshExpiresInSec');

    const cookie = res.cookies.find((c) => c.name === 'refresh_token');
    expect(cookie).toBeDefined();
    expect(cookie?.value).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Unauthenticated access — every protected endpoint must return 401
// ---------------------------------------------------------------------------

describe('Unauthenticated access', () => {
  let someUserId: number;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: USER_PREFIX,
      payload: {
        username: 'unauthuser',
        password: 'testpassword123',
        fullname: 'Unauth User',
      },
    });
    const location = res.headers['location'] as string;
    someUserId = parseInt(location.split('/').pop()!);
  });

  it('GET /user with no token returns 401', async () => {
    const res = await app.inject({ method: 'GET', url: USER_PREFIX });
    expect(res.statusCode).toBe(401);
  });

  it('GET /user/:id with no token returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${USER_PREFIX}/${someUserId}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('PUT /user/:id with no token returns 401', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${USER_PREFIX}/${someUserId}`,
      payload: { fullname: 'Should Fail' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('DELETE /user/:id with no token returns 401', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `${USER_PREFIX}/${someUserId}`,
    });
    expect(res.statusCode).toBe(401);
  });
});

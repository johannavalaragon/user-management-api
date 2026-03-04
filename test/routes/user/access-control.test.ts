/**
 * Access-control tests: who can read, update, and delete whom.
 *
 * Bootstrap: clear the DB, write a real admin user directly via UserDBFactory
 * + bcrypt, then build the app so the route module starts with that admin in
 * its live DB.  We then log in via the API to get a genuine admin token.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp } from '../../vitest-helper.js';
import UserDBFactory from '../../../src/lib/csvuserdatabase.js';
import { config } from '../../../src/config.js';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let adminToken: string;

// Regular users — created via API so they exist in the server's live DB.
let user1Token: string;
let user1Id: number;
let user2Id: number;
let user3Token: string; // kept alive for the "non-admin clears DB → 403" test

const adminPassword = 'adminpassword123';
const USER_PREFIX = `${config.routes.api_prefix.replace(/\/$/, '')}${config.routes.user_prefix}`;

beforeAll(async () => {
  // 1. Clear the DB and seed a real admin user before the app is built.
  //    The route module reads config.db.filename at load time, so the admin
  //    must be present in the CSV before buildTestApp() is called.
  const db = await UserDBFactory(config.db.filename);
  await db.clear();
  const hashedPassword = await bcrypt.hash(
    adminPassword,
    config.auth.bcrypt_salt_rounds,
  );
  await db.add({
    name: 'admin',
    fullname: 'Admin User',
    password: hashedPassword,
    admin: true,
  });

  // 2. Build the app — the route module now reads a CSV that contains admin.
  app = await buildTestApp({ cookies: true });

  // 3. Log in as admin to get a real token (no synthetic JWTs needed).
  const loginRes = await app.inject({
    method: 'POST',
    url: `${USER_PREFIX}/login`,
    payload: { username: 'admin', password: adminPassword },
  });
  adminToken = loginRes.json().accessToken;

  // 4. Create three regular users via the API.
  const res1 = await app.inject({
    method: 'POST',
    url: USER_PREFIX,
    payload: {
      username: 'acluser1',
      password: 'password123!',
      fullname: 'ACL User One',
    },
  });
  user1Token = res1.json().accessToken;
  user1Id = parseInt((res1.headers['location'] as string).split('/').pop()!);

  const res2 = await app.inject({
    method: 'POST',
    url: USER_PREFIX,
    payload: {
      username: 'acluser2',
      password: 'password456!',
      fullname: 'ACL User Two',
    },
  });
  user2Id = parseInt((res2.headers['location'] as string).split('/').pop()!);

  const res3 = await app.inject({
    method: 'POST',
    url: USER_PREFIX,
    payload: {
      username: 'acluser3',
      password: 'password789!',
      fullname: 'ACL User Three',
    },
  });
  user3Token = res3.json().accessToken;
});

afterAll(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// GET /user  (list — admin-only)
// ---------------------------------------------------------------------------

describe('GET /user (list)', () => {
  it('non-admin gets 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: USER_PREFIX,
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('admin gets 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: USER_PREFIX,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /user/:id  (own profile, another user's profile, admin)
// ---------------------------------------------------------------------------

describe('GET /user/:id', () => {
  it('user reads own profile: 200, returns { username, id, fullname, admin }, no password field', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${USER_PREFIX}/${user1Id}`,
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('username', 'acluser1');
    expect(body).toHaveProperty('id', user1Id);
    expect(body).toHaveProperty('fullname', 'ACL User One');
    expect(body).toHaveProperty('admin', false);
    expect(body).not.toHaveProperty('password');
  });

  it("user reading another user's profile gets 403 (not 401)", async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${USER_PREFIX}/${user2Id}`,
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('admin reads any profile: 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${USER_PREFIX}/${user1Id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// PUT /user/:id  (own profile, another user, admin)
// ---------------------------------------------------------------------------

describe('PUT /user/:id', () => {
  it('user updates own profile with username in body: 200', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${USER_PREFIX}/${user1Id}`,
      headers: { Authorization: `Bearer ${user1Token}` },
      payload: { username: 'acluser1', fullname: 'ACL User One Updated' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('user updates own profile WITHOUT username in body: 200 (not 401)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${USER_PREFIX}/${user1Id}`,
      headers: { Authorization: `Bearer ${user1Token}` },
      payload: { fullname: 'ACL User One Again' },
    });
    expect(res.statusCode).toBe(200);
  });

  it("user updating another user's profile gets 403 (not 401)", async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${USER_PREFIX}/${user2Id}`,
      headers: { Authorization: `Bearer ${user1Token}` },
      payload: { fullname: 'Attempted Unauthorized Update' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('admin updates any user: 200', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${USER_PREFIX}/${user2Id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { fullname: 'Admin Updated Name' },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// DELETE /user/:id  (own account, another user, admin)
// ---------------------------------------------------------------------------
// NOTE: user deletion is intentionally ordered so that each user is only
// deleted once and later tests still have valid subjects.

describe('DELETE /user/:id', () => {
  it('user trying to delete another user gets 403 (not 401)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `${USER_PREFIX}/${user2Id}`,
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('admin deletes a user: 200', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `${USER_PREFIX}/${user2Id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('user deletes self: 200', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `${USER_PREFIX}/${user1Id}`,
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// DELETE /user  (clear all — admin-only)
// ---------------------------------------------------------------------------

describe('DELETE /user (clear all)', () => {
  it('non-admin gets 403', async () => {
    // user3 is still alive at this point; their token is a valid non-admin JWT.
    const res = await app.inject({
      method: 'DELETE',
      url: USER_PREFIX,
      headers: { Authorization: `Bearer ${user3Token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('admin clears DB: 200', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: USER_PREFIX,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

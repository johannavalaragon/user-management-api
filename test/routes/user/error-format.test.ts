/* eslint-disable vitest/expect-expect */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../vitest-helper.js';
import UserDBFactory from '../../../src/lib/csvuserdatabase.js';
import { config } from '../../../src/config.js';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let adminToken: string;
let userToken: string;

const adminPassword = 'adminpassword123';
const USER_PREFIX = `${config.routes.api_prefix.replace(/\/$/, '')}${config.routes.user_prefix}`;

function expectProblemResponse(
  res: Awaited<ReturnType<FastifyInstance['inject']>>,
  expectedStatus: number,
) {
  expect(res.statusCode).toBe(expectedStatus);
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json\b/i);

  const body = res.json();
  expect(body).toHaveProperty('type', 'about:blank');
  expect(body).toHaveProperty('status', expectedStatus);
  expect(body).toHaveProperty('title');
  expect(typeof body.title).toBe('string');
  expect(body.title.length).toBeGreaterThan(0);
  expect(body).toHaveProperty('detail');
  expect(typeof body.detail).toBe('string');
  expect(body.detail.length).toBeGreaterThan(0);
}

beforeAll(async () => {
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

  app = await buildTestApp({ cookies: true });

  const adminLoginRes = await app.inject({
    method: 'POST',
    url: `${USER_PREFIX}/login`,
    payload: { username: 'admin', password: adminPassword },
  });
  adminToken = adminLoginRes.json().accessToken;

  const createUserRes = await app.inject({
    method: 'POST',
    url: USER_PREFIX,
    payload: {
      username: 'errorformatuser',
      password: 'password123!',
      fullname: 'Error Format User',
    },
  });
  userToken = createUserRes.json().accessToken;
});

afterAll(async () => {
  await app.close();
});

describe('Error Response Format (RFC 7807 style)', () => {
  describe('AJV validation errors', () => {
    it('returns problem+json for params validation errors (400)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${USER_PREFIX}/not-an-integer`,
      });

      expectProblemResponse(res, 400);
    });

    it('returns problem+json for body minLength validation errors (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: USER_PREFIX,
        payload: {
          username: '',
          password: 'longpassword',
          fullname: 'Bad User',
        },
      });

      expectProblemResponse(res, 400);
    });

    it('returns problem+json for body additionalProperties validation errors (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: USER_PREFIX,
        payload: {
          username: 'extrafielduser',
          password: 'longpassword',
          fullname: 'Extra Field User',
          admin: true,
        },
      });

      expectProblemResponse(res, 400);
    });
  });

  it('returns problem+json for schema validation errors (400)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${USER_PREFIX}/not-an-integer`,
    });

    expectProblemResponse(res, 400);
  });

  it('returns problem+json for authentication errors (401)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: USER_PREFIX,
    });

    expectProblemResponse(res, 401);
  });

  it('returns problem+json for authorization errors (403)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: USER_PREFIX,
      headers: { Authorization: `Bearer ${userToken}` },
    });

    expectProblemResponse(res, 403);
  });

  it('returns problem+json for not found errors (404)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${USER_PREFIX}/999999`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expectProblemResponse(res, 404);
  });
});

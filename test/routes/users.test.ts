/* Unit tests for the User REST API - stage 2 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp } from '../vitest-helper.js';
import UserDBFactory from '../../src/lib/csvuserdatabase.js';
import { config } from '../../src/config.js';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let adminToken: string;
const adminPassword = 'adminpassword123';
const API_PREFIX = config.routes.api_prefix;
const USER_PREFIX = `${API_PREFIX.replace(/\/$/, '')}${config.routes.user_prefix}`;

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

  const loginRes = await app.inject({
    method: 'POST',
    url: `${USER_PREFIX}/login`,
    payload: { username: 'admin', password: adminPassword },
  });
  adminToken = loginRes.json().accessToken;
});

afterAll(async () => {
  await app.close();
});

describe('Basic API Tests', () => {
  it('checks that the root route is up', async () => {
    const res = await app.inject({ method: 'GET', url: API_PREFIX });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ root: true });
  });
});

/*
 * Tests rely on vitest running tests within a file in declaration order.
 * We reset the DB first, create users, then test retrieval/update/deletion.
 */

// http://listofrandomnames.com
const users = [
  'Brinda Breau',
  'Stephania Sollers',
  'Kourtney Keels',
  'Tamatha Tiggs',
  'Melanie Montijo',
  'Roselyn Relf',
  'Eugenio Eppinger',
  'Racheal Reeves',
  'Tomeka Townsley',
  'Brittani Breeden',
  'Cuc Cavallo',
  'Santana Stolz',
  'Josiah Jerkins',
  'Jerrold Jolin',
  'Leigh Langner',
  'Sunday Shulman',
  'Aimee Asay',
  'Jessie Jun',
  'Gerard Gayhart',
  'Xiomara Xiong',
  'Tijuana Tsao',
  'Lucilla Longtin',
  'Madaline Mayson',
  'Charisse Casey',
  'Genia Goldfarb',
  'Doreatha Dampier',
  'Daniella Devoe',
  'Dyan Duquette',
  'Anne Allensworth',
  'Delena Dinan',
].map((fullname) => {
  const [first, last] = fullname.split(/\s+/);
  return {
    name: first.toLowerCase().charAt(0) + last.toLowerCase(),
    password: last.split('').reverse().join('').padEnd(8, '!'),
    fullname,
    id: -1,
  };
});

describe('Test User Database Deletion', () => {
  it('tests that the user database can be reset', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: USER_PREFIX,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('Test User Creation', () => {
  for (const user of users) {
    it(`tests that user ${user.name} can be created`, async () => {
      const res = await app.inject({
        method: 'POST',
        url: USER_PREFIX,
        payload: {
          username: user.name,
          password: user.password,
          fullname: user.fullname,
        },
      });
      expect(res.statusCode).toBe(201);
      user.id = parseInt((res.headers['location'] as string).split('/').pop()!);
    });
  }

  it('tests that the Location header is set on creation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: USER_PREFIX,
      payload: {
        username: 'locationtest',
        password: 'testpassword',
        fullname: 'Location Test',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers['location']).toBeDefined();
    expect(res.headers['location']).toMatch(new RegExp(`${USER_PREFIX}/\\d+`));
  });

  it('tests that a user can be created without a fullname', async () => {
    const res = await app.inject({
      method: 'POST',
      url: USER_PREFIX,
      payload: { username: 'nofullname', password: 'longpassword' },
    });
    expect(res.statusCode).toBe(201);
    const id = parseInt((res.headers['location'] as string).split('/').pop()!);
    const getRes = await app.inject({
      method: 'GET',
      url: `${USER_PREFIX}/${id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().username).toBe('nofullname');
  });

  it('tests that attempts to create incomplete users are rejected', async () => {
    const res = await app.inject({
      method: 'POST',
      url: USER_PREFIX,
      payload: { fullname: 'Mr. NoName & NoPassword' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('tests that attempts to create users w/o password are rejected', async () => {
    const res = await app.inject({
      method: 'POST',
      url: USER_PREFIX,
      payload: { fullname: 'Mrs. NoPassword', username: 'mrsnopassword' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('Test Duplicate User Creation', () => {
  it("tests that existing users can't be created again with the same name", async () => {
    const res = await app.inject({
      method: 'POST',
      url: USER_PREFIX,
      payload: {
        username: users[0].name,
        password: users[0].password,
        fullname: users[0].fullname,
      },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('Test Post User Creation', () => {
  for (const user of users) {
    it(`tests that user ${user.name} can be retrieved`, async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${USER_PREFIX}/${user.id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/json/);
      const ruser = res.json();
      expect(ruser.username).toEqual(user.name);
      expect(ruser.fullname).toEqual(user.fullname);
      expect(ruser).not.toHaveProperty('password');
    });
  }

  it('tests that users can be listed', async () => {
    const res = await app.inject({
      method: 'GET',
      url: USER_PREFIX,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const { users: rusers } = res.json();
    for (const { name, id } of users) {
      expect(rusers).toContainEqual({ username: name, id });
    }
  });

  it('tests that a user can be deleted', async () => {
    const usera = users[0];
    const delRes = await app.inject({
      method: 'DELETE',
      url: `${USER_PREFIX}/${usera.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(delRes.statusCode).toBe(200);
    const getRes = await app.inject({
      method: 'GET',
      url: `${USER_PREFIX}/${usera.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(getRes.statusCode).toBe(404);
  });

  it("tests that a user's fullname and password can be updated", async () => {
    const userb = users[1];
    const putRes = await app.inject({
      method: 'PUT',
      url: `${USER_PREFIX}/${userb.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { fullname: 'Stephania Kellogg', password: 'new password' },
    });
    expect(putRes.statusCode).toBe(200);
    const getRes = await app.inject({
      method: 'GET',
      url: `${USER_PREFIX}/${userb.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(getRes.statusCode).toBe(200);
    const ruser = getRes.json();
    expect(ruser.fullname).toBe('Stephania Kellogg');
    userb.fullname = 'Stephania Kellogg';
    userb.password = 'new password';
  });

  it("tests that a user's name can be updated", async () => {
    const userc = users[2];
    const newname = 'newkkeels';
    const putRes = await app.inject({
      method: 'PUT',
      url: `${USER_PREFIX}/${userc.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { username: newname },
    });
    expect(putRes.statusCode).toBe(200);
    const getRes = await app.inject({
      method: 'GET',
      url: `${USER_PREFIX}/${userc.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().username).toBe(newname);
    users[2].name = newname;
  });

  it('tests that updating only fullname preserves the password', async () => {
    const userd = users[3];
    const oldPassword = userd.password;
    const putRes = await app.inject({
      method: 'PUT',
      url: `${USER_PREFIX}/${userd.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { fullname: 'Tamatha Updated' },
    });
    expect(putRes.statusCode).toBe(200);
    const usersinfile = await UserDBFactory(config.db.filename);
    const storeduser = usersinfile.getByName(userd.name);
    expect(await bcrypt.compare(oldPassword, storeduser.password)).toBeTruthy();
    userd.fullname = 'Tamatha Updated';
  });

  it('tests that updating only password preserves the fullname', async () => {
    const usere = users[4];
    const oldFullname = usere.fullname;
    const putRes = await app.inject({
      method: 'PUT',
      url: `${USER_PREFIX}/${usere.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { password: 'brandnewpassword' },
    });
    expect(putRes.statusCode).toBe(200);
    const getRes = await app.inject({
      method: 'GET',
      url: `${USER_PREFIX}/${usere.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(getRes.json().fullname).toBe(oldFullname);
    const usersinfile = await UserDBFactory(config.db.filename);
    const storeduser = usersinfile.getByName(usere.name);
    expect(
      await bcrypt.compare('brandnewpassword', storeduser.password),
    ).toBeTruthy();
    usere.password = 'brandnewpassword';
  });
});

describe('Test User Listing After Modifications', () => {
  // Build lookup by name, reflecting all mutations (rename, delete, extras)
  // Must be in beforeAll so it runs after prior it-blocks (e.g. the rename at line 238)
  const byName: Record<string, { name: string; fullname: string }> = {};
  beforeAll(() => {
    users.forEach((user) => (byName[user.name] = user));
    byName['locationtest'] = {
      name: 'locationtest',
      fullname: 'Location Test',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    byName['nofullname'] = { name: 'nofullname', fullname: undefined as any };
  });

  it('tests that the user list reflects all changes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: USER_PREFIX,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    const { users: rusers } = res.json();
    const justUsername = ({ username }: { username: string }) => username;
    const have = new Set(rusers.map(justUsername));
    // Expected: original users minus deleted first, plus extras from earlier tests
    const shouldBe = new Set([
      ...users.slice(1).map(({ name }) => name),
      'locationtest',
      'nofullname',
    ]);
    expect(have).toEqual(shouldBe);
    await Promise.all(
      rusers.map(async (ruser: { id: number; username: string }) => {
        const innerRes = await app.inject({
          method: 'GET',
          url: `${USER_PREFIX}/${ruser.id}`,
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(innerRes.statusCode).toBe(200);
        expect(innerRes.headers['content-type']).toMatch(/json/);
        const { id, fullname } = innerRes.json();
        expect(id).toBe(ruser.id);
        const expected = byName[ruser.username]?.fullname;
        expect(fullname).toBe(expected);
      }),
    );
  });

  it('checks that all passwords are encrypted properly', async () => {
    const usersinfile = await UserDBFactory(config.db.filename);
    await Promise.all(
      users.slice(1).map(async (user) => {
        expect(usersinfile.byName.has(user.name)).toBeTruthy();
        const storeduser = usersinfile.getByName(user.name);
        expect(
          await bcrypt.compare(user.password, storeduser.password),
        ).toBeTruthy();
      }),
    );
  });
});

describe('Test Error Cases', () => {
  it('returns 404 for non-existent user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${USER_PREFIX}/99999`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when deleting non-existent user', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `${USER_PREFIX}/99999`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when updating non-existent user', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${USER_PREFIX}/99999`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { fullname: 'Nobody' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('Test Schema Validation', () => {
  it('rejects creating a user with a password shorter than 8 characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: USER_PREFIX,
      payload: { username: 'shortpw', password: 'abc', fullname: 'Short PW' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects creating a user with an empty name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: USER_PREFIX,
      payload: {
        username: '',
        password: 'longpassword',
        fullname: 'Empty Name',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects creating a user with additional properties', async () => {
    const res = await app.inject({
      method: 'POST',
      url: USER_PREFIX,
      payload: {
        username: 'extraprops',
        password: 'longpassword',
        fullname: 'Extra',
        admin: true,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects updating a user with additional properties', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${USER_PREFIX}/${users[5].id}`,
      payload: { fullname: 'Updated', admin: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-integer id on GET', async () => {
    const res = await app.inject({ method: 'GET', url: `${USER_PREFIX}/abc` });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-integer id on DELETE', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `${USER_PREFIX}/abc`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-integer id on PUT', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${USER_PREFIX}/abc`,
      payload: { fullname: 'Nobody' },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects updating a user's username to another existing username", async () => {
    const userb = users[1];
    const existingUsername = users[2].name; // renamed earlier to `newkkeels`

    const putRes = await app.inject({
      method: 'PUT',
      url: `${USER_PREFIX}/${userb.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { username: existingUsername },
    });
    expect(putRes.statusCode).toBe(409);
  });
});

/*
 * API Stage 2.
 *
 * Code handcrafted by gback
 */
import { FastifyPluginAsync } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import {
  registerRefreshTokenRecord,
  lookupRefreshTokenRecord,
  revokeTokenFamilyRecords,
  revokeRefreshTokenRecord,
} from './refresh_tokens.js';
import UserDBFactory from '../../lib/csvuserdatabase.js';
import _bcrypt from 'bcrypt';
import { config } from '../../config.js';

// begin typescript declarations
type AccessPayload = {
  id: number;
  sub: string;
  role: string;
  iat: number;
  exp: number;
};

type RefreshPayload = {
  sub: string;
  jti: string;
  scope: string[];
  iat: number;
  exp: number;
};

declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: AccessPayload;
  }
  interface JWT {
    access: JWT;
    refresh: JWT;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    mustbeauthenticated: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    mustbeadmin: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }

  interface FastifyRequest {
    accessVerify<T extends object = object>(): Promise<T>;
    user: AccessPayload;
  }
}

/* JSON schemas used for various requests. */
const newUserRequestSchema = {
  body: {
    type: 'object',
    properties: {
      username: { type: 'string', minLength: 1 },
      fullname: { type: 'string' },
      password: { type: 'string', minLength: 8 },
    },
    required: ['username', 'password'],
    additionalProperties: false,
  },
};

const updateRequestSchema = {
  body: {
    type: 'object',
    properties: {
      username: { type: 'string', minLength: 1 },
      fullname: { type: 'string' },
      password: { type: 'string', minLength: 8 },
    },
    additionalProperties: false,
  },
};

const userInfoSchema = {
  body: {
    type: 'object',
    properties: {
      username: { type: 'string', minLength: 1 },
      fullname: { type: 'string' },
      id: { type: 'integer' },
      admin: { type: 'boolean' },
    },
    additionalProperties: false,
  },
};

const loginSchema = {
  body: {
    type: 'object',
    properties: {
      username: { type: 'string', minLength: 1 },
      password: { type: 'string', minLength: 8 },
    },
    additionalProperties: false,
  },
};

const idSchema = {
  params: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
    },
    required: ['id'],
  },
};

const messageSchema = {
  type: 'object',
  properties: {
    message: { type: 'string' },
  },
  required: ['message'],
  additionalProperties: false,
};

const accessTokenReturnSchema = {
  type: 'object',
  properties: {
    rotated: { type: 'boolean' },
    accessToken: { type: 'string' },
    accessExpiresInSec: { type: 'number' },
    refreshExpiresInSec: { type: 'number' },
  },
  required: [
    'accessToken',
    'accessExpiresInSec',
    'refreshExpiresInSec',
    'rotated',
  ],
  additionalProperties: false,
};

const userdb = UserDBFactory(config.db.filename || 'userdatabase.csv');

const user: FastifyPluginAsync = async (fastify, _opts): Promise<void> => {
  await fastify.register(fastifyJwt, {
    secret: config.auth.access_token_secret,
    namespace: 'access',
    jwtVerify: 'accessVerify',
    sign: { expiresIn: config.auth.access_token_expiration },
  });

  await fastify.register(fastifyJwt, {
    secret: config.auth.refresh_token_secret,
    namespace: 'refresh',
    cookie: {
      cookieName: 'refresh_token',
      signed: false,
    },
    sign: { expiresIn: config.auth.refresh_token_expiration },
  });

  fastify.decorate('mustbeauthenticated', async (request, _reply) => {
    try {
      await request.accessVerify();
    } catch {
      throw fastify.httpErrors.unauthorized();
    }
  });

  fastify.decorate('mustbeadmin', async (request, _reply) => {
    if (!request.user || request.user.role !== 'admin') {
      throw fastify.httpErrors.forbidden();
    }
  });

  /* Get list of all users. Admin only. */
  fastify.get(
    '/',
    { preHandler: [fastify.mustbeauthenticated, fastify.mustbeadmin] },
    async (_req, _res) => {
      const db = await userdb;
      const formattedUsers = Array.from(db.byName.entries()).map(
        ([name, u]) => ({
          id: u.id,
          username: name,
        }),
      );
      formattedUsers.sort((a, b) => a.id! - b.id!);
      return { users: formattedUsers };
    },
  );

  /* Get information about a single user (WITH REDIS CACHING) */
  fastify.get<{
    Params: { id: number };
  }>(
    '/:id',
    {
      schema: {
        ...idSchema,
        response: {
          200: {
            ...userInfoSchema,
          },
        },
      },
      preHandler: [fastify.mustbeauthenticated],
    },
    async (req, _res) => {
      if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
        throw fastify.httpErrors.forbidden(
          'You can only view your own profile',
        );
      }

      // --- CACHE CHECK ---
      const cacheKey = `user:${req.params.id}`;
      const cachedData = await fastify.redis.get(cacheKey);

      if (cachedData) {
        // Return instantly from Redis!
        return JSON.parse(cachedData);
      }

      // --- CACHE MISS: FETCH FROM DB ---
      const db = await userdb;
      const fetchedUser = db.getById(req.params.id);

      if (!fetchedUser) {
        throw fastify.httpErrors.notFound('User not found');
      }

      const responseData = {
        id: fetchedUser.id,
        username: fetchedUser.name,
        fullname: fetchedUser.fullname || fetchedUser.name,
        admin: fetchedUser.name === 'admin',
      };

      // --- SAVE TO CACHE FOR NEXT TIME ---
      await fastify.redis.set(cacheKey, JSON.stringify(responseData));

      return responseData;
    },
  );

  fastify.post<{
    Body: {
      username: string;
      password: string;
    };
  }>(
    '/login',
    {
      schema: {
        ...loginSchema,
        response: {
          200: { ...accessTokenReturnSchema },
        },
      },
    },
    async (req, res) => {
      const db = await userdb;

      const u = db.getByName(req.body.username);
      if (!u) {
        throw fastify.httpErrors.unauthorized('Invalid username or password');
      }

      const isMatch = await _bcrypt.compare(req.body.password, u.password);
      if (!isMatch) {
        throw fastify.httpErrors.unauthorized('Invalid username or password');
      }

      const role = u.name === 'admin' ? 'admin' : 'user';
      const refreshTtl = Number(config.auth.refresh_token_expiration) || 604800;

      const record = registerRefreshTokenRecord(
        u.name,
        u.id!,
        role,
        refreshTtl,
      );

      const refreshToken = fastify.jwt.refresh.sign({
        sub: u.name,
        jti: record.tokenId,
        scope: ['refresh'],
      });

      const accessToken = fastify.jwt.access.sign({
        id: u.id!,
        sub: u.name,
        role: role,
      });

      res.setCookie('refresh_token', refreshToken, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
      });

      return {
        rotated: false,
        accessToken,
        accessExpiresInSec: Number(config.auth.access_token_expiration) || 900,
        refreshExpiresInSec: refreshTtl,
      };
    },
  );

  fastify.post('/refresh', async (req, res) => {
    const token = req.cookies.refresh_token;
    if (!token) throw fastify.httpErrors.unauthorized('Missing refresh cookie');

    let decoded: RefreshPayload;
    try {
      decoded = fastify.jwt.refresh.verify<RefreshPayload>(token);
    } catch {
      throw fastify.httpErrors.unauthorized(
        'Invalid or expired refresh cookie',
      );
    }

    const { jti } = decoded;

    const trackedToken = lookupRefreshTokenRecord(jti);
    if (!trackedToken) {
      throw fastify.httpErrors.unauthorized('Invalid refresh token');
    }

    if (trackedToken.revoked) {
      revokeTokenFamilyRecords(trackedToken.familyId);
      throw fastify.httpErrors.unauthorized(
        'Refresh token reuse detected. Session terminated.',
      );
    }

    revokeRefreshTokenRecord(jti);

    const db = await userdb;
    const u = db.getById(trackedToken.id);
    if (!u) {
      throw fastify.httpErrors.unauthorized('User no longer exists');
    }

    const refreshTtl = Number(config.auth.refresh_token_expiration) || 604800;
    const newRecord = registerRefreshTokenRecord(
      u.name,
      u.id!,
      trackedToken.role,
      refreshTtl,
      trackedToken.familyId,
    );

    const newRefreshToken = fastify.jwt.refresh.sign({
      sub: u.name,
      jti: newRecord.tokenId,
      scope: ['refresh'],
    });

    const newAccessToken = fastify.jwt.access.sign({
      id: u.id!,
      sub: u.name,
      role: trackedToken.role,
    });

    res.setCookie('refresh_token', newRefreshToken, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });

    return {
      rotated: true,
      accessToken: newAccessToken,
      accessExpiresInSec: Number(config.auth.access_token_expiration) || 900,
      refreshExpiresInSec: refreshTtl,
    };
  });

  fastify.post<{
    Body: {
      username: string;
      fullname: string;
      password: string;
    };
  }>(
    '/',
    {
      schema: {
        ...newUserRequestSchema,
        response: {
          201: {
            ...accessTokenReturnSchema,
          },
        },
      },
    },
    async (req, res) => {
      const db = await userdb;

      if (db.getByName(req.body.username)) {
        throw fastify.httpErrors.conflict('User already exists');
      }

      const hashedPassword = await _bcrypt.hash(req.body.password, 10);
      const newId = await db.add({
        name: req.body.username,
        fullname: req.body.fullname,
        password: hashedPassword,
      });

      const u = db.getById(newId);
      if (!u) {
        throw fastify.httpErrors.internalServerError();
      }

      const role = 'user';
      const refreshTtl = Number(config.auth.refresh_token_expiration) || 604800;

      const record = registerRefreshTokenRecord(
        u.name,
        u.id!,
        role,
        refreshTtl,
      );

      const refreshToken = fastify.jwt.refresh.sign({
        sub: u.name,
        jti: record.tokenId,
        scope: ['refresh'],
      });

      const accessToken = fastify.jwt.access.sign({
        id: u.id!,
        sub: u.name,
        role: role,
      });

      res.setCookie('refresh_token', refreshToken, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
      });

      res.header('Location', `/api/user/${newId}`);
      res.status(201);

      return {
        rotated: false,
        accessToken,
        accessExpiresInSec: Number(config.auth.access_token_expiration) || 900,
        refreshExpiresInSec: refreshTtl,
      };
    },
  );

  /* Update user profile (WITH REDIS CACHE INVALIDATION) */
  fastify.put<{
    Params: { id: number };
    Body: {
      username: string;
      fullname: string;
      password: string;
    };
  }>(
    '/:id',
    {
      schema: {
        ...idSchema,
        ...updateRequestSchema,
        response: {
          200: {
            ...messageSchema,
          },
        },
      },
      preHandler: [fastify.mustbeauthenticated],
    },
    async (req, _res) => {
      if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
        throw fastify.httpErrors.forbidden(
          'You can only update your own profile',
        );
      }

      const db = await userdb;
      const targetUser = db.getById(req.params.id);

      if (!targetUser) {
        throw fastify.httpErrors.notFound('User not found');
      }

      if (req.body.username !== undefined) {
        const existingUser = db.getByName(req.body.username);
        if (existingUser && existingUser.id !== targetUser.id) {
          throw fastify.httpErrors.conflict('duplicate user name');
        }
        targetUser.name = req.body.username;
      }

      if (req.body.password !== undefined) {
        targetUser.password = await _bcrypt.hash(req.body.password, 10);
      }

      if (req.body.fullname !== undefined) {
        targetUser.fullname = req.body.fullname;
      }

      await db.save();

      // --- DELETE STALE CACHE ---
      await fastify.redis.del(`user:${req.params.id}`);

      return { message: 'user updated' };
    },
  );

  /* Delete user (WITH REDIS CACHE INVALIDATION) */
  fastify.delete<{
    Params: { id: number };
  }>(
    '/:id',
    {
      schema: {
        ...idSchema,
      },
      preHandler: [fastify.mustbeauthenticated],
    },
    async (req, _res) => {
      if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
        throw fastify.httpErrors.forbidden(
          'You can only delete your own profile',
        );
      }

      const db = await userdb;
      const targetUser = db.getById(req.params.id);

      if (!targetUser) {
        throw fastify.httpErrors.notFound('User not found');
      }

      await db.delete(req.params.id);

      // --- CLEAN UP CACHE ---
      await fastify.redis.del(`user:${req.params.id}`);

      return { message: 'user deleted' };
    },
  );

  /* Delete the entire user database. Admin only. */
  fastify.delete(
    '/',
    {
      preHandler: [fastify.mustbeauthenticated, fastify.mustbeadmin],
    },
    async (_req, _res) => {
      (await userdb).clear();
      return { message: 'user database deleted' };
    },
  );
};

export default user;

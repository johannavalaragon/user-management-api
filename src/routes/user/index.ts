/*
 * API Stage 2.
 *
 * Code handcrafted by gback
 */
import { FastifyPluginAsync, FastifyReply } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import {
  registerRefreshTokenRecord,
  lookupRefreshTokenRecord,
  revokeTokenFamilyRecords,
  revokeRefreshTokenRecord,
  // RefreshTokenRecord,
} from './refresh_tokens.js';
import UserDBFactory from '../../lib/csvuserdatabase.js';
import _bcrypt from 'bcrypt'; // underscored to avoid typescript error
import { config } from '../../config.js';

// begin typescript declarations
// payload of a JWT access token; doubles as .user property of the request, see below
type AccessPayload = {
  id: number; // user id
  sub: string; // user name
  role: string; // role: user/admin
  iat: number; // issued-at time
  exp: number; // expires at time
};

// payload of a JWT refresh token

type RefreshPayload = {
  sub: string; // user name
  jti: string; // jwt token id
  scope: string[]; // scope to denote this is a refresh token
  iat: number; // issued-at time
  exp: number; // expires at time
};

declare module '@fastify/jwt' {
  // as per https://github.com/fastify/fastify-jwt?tab=readme-ov-file#typescript-1
  interface FastifyJWT {
    user: AccessPayload;
  }
  // Extend the JWT interface so TypeScript knows about the fastify.jwt.access
  // and fastify.jwt.refresh methods that are added by @fastify/jwt.
  interface JWT {
    access: JWT;
    refresh: JWT;
  }
}

declare module 'fastify' {
  // TS definitions for the mustbeauthenticated and mustbeadmin decorators
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

  // the fastify request object is augmented with an .accessVerify method
  // and a .user property
  interface FastifyRequest {
    accessVerify<T extends object = object>(): Promise<T>;
    user: AccessPayload;
  }
}

// end typescript declarations
// begin JSON schema declarations

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

// end JSON schema declarations

const userdb = UserDBFactory(config.db.filename);

const user: FastifyPluginAsync = async (fastify, _opts): Promise<void> => {
  // The 'access' instance signs/verifies access tokens.
  // Stored at fastify.jwt.access; request.accessVerify() reads
  // Authorization: Bearer automatically.
  // See https://github.com/fastify/fastify-jwt?tab=readme-ov-file#sign
  await fastify.register(fastifyJwt, {
    secret: config.auth.access_token_secret,
    namespace: 'access', // fastify.jwt.access = JWT instance
    jwtVerify: 'accessVerify', // renames request.jwtVerify -> request.accessVerify
    sign: { expiresIn: config.auth.access_token_expiration },
  });

  /* Implement this:
   * register a second instance 'fastify.jwt.refresh' (like above)
   * with namespace 'refresh', using config.auth.refresh_token_secret and expiration.
   */
  await fastify.register(fastifyJwt, {
    secret: config.auth.refresh_token_secret,
    namespace: 'refresh',
    cookie: {
      cookieName: 'refresh_token',
      signed: false,
    },
    sign: { expiresIn: config.auth.refresh_token_expiration },
  });
  // Decorate the fastify object with a method 'mustbeauthenticated' that
  // can then be invoked as a preHandler, see
  // https://fastify.dev/docs/latest/Reference/Lifecycle/
  // and https://fastify.dev/docs/latest/Reference/Decorators/
  fastify.decorate('mustbeauthenticated', async (request, _reply) => {
    /* Implement this by calling accessVerify and setting request.user
     * If the access token is invalid, throw 401 using fastify.httpErrors.unauthorized
     */
    try {
      await request.accessVerify();
    } catch {
      throw fastify.httpErrors.unauthorized();
    }
  });

  fastify.decorate('mustbeadmin', async (request, _reply) => {
    /* Implement this by throwing httpErrors.forbidden if the user is not an admin */
    if (!request.user || request.user.role !== 'admin') {
      throw fastify.httpErrors.forbidden();
    }
  });

  /* Get list of all users. Admin only. */
  fastify.get(
    '/',
    // Add preHandler here
    { preHandler: [fastify.mustbeauthenticated, fastify.mustbeadmin] },
    async (_req, _res) => {
      /* Implement this. Return the user list in [{ id, username }] format. */
      const db = await userdb;

      // Grab all users from the database and format them as an array of objects
      const formattedUsers = Array.from(db.byName.entries()).map(
        ([name, u]) => ({
          id: u.id,
          username: name,
        }),
      );

      // Sort them by ID just to guarantee the tests get a predictable order
      formattedUsers.sort((a, b) => a.id! - b.id!);

      return { users: formattedUsers };
    },
  );

  /* Get information about a single user.
   * User may obtain only their own user info records.
   * Admins may obtain all records.
   */
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
      /* Implement this to perform the necessary access control checks
       * and return an object conforming to userInfoSchema if they
       * check out.
       */
      // Access control check: Must be admin or the requesting user
      if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
        throw fastify.httpErrors.forbidden(
          'You can only view your own profile',
        );
      }

      const db = await userdb;
      const fetchedUser = db.getById(req.params.id);

      if (!fetchedUser) {
        throw fastify.httpErrors.notFound('User not found');
      }

      return {
        id: fetchedUser.id,
        username: fetchedUser.name,
        fullname: fetchedUser.fullname,
        admin: fetchedUser.name === 'admin',
      };
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
      /* Implement this by validating the password
       * and returning an access token and refresh token if successful.
       *
       * Note: this may share logic with the POST /user endpoint where
       * newly created users are logged in.
       *
       * Note: this may share logic with when a refresh token is used.
       */
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

      // Register the refresh token in the professor's tracking system
      const record = registerRefreshTokenRecord(u.name, u.id, role, refreshTtl);

      // Sign the Refresh Token
      const refreshToken = fastify.jwt.refresh.sign({
        sub: u.name,
        jti: record.tokenId,
        scope: ['refresh'],
      });

      // Sign the Access Token
      const accessToken = fastify.jwt.access.sign({
        id: u.id,
        sub: u.name,
        role: role,
      });

      // Set the Refresh Token as an HTTP-Only Cookie
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

  // Clients call /refresh when the short-lived access token expires (or is about to).
  // Either reactively (got a 401, refresh, retry) or proactively (check exp claim, refresh
  // before it expires). The refresh token's lifetime is the real session duration.
  fastify.post('/refresh', async (req, res) => {
    /* Implement this.
     * - retrieve refresh token from req.cookies
     * - decode + verify it
     * - look up refresh token record via lookupRefreshTokenRecord
     * - if already revoked, revoke family
     * - revoke the refresh token
     * - Call registerRefreshTokenRecord to register new one
     * - issue new access token and return both access and refresh to client
     */
    // Retrieve refresh token from cookies
    const token = req.cookies.refresh_token;
    if (!token) throw fastify.httpErrors.unauthorized('Missing refresh cookie');

    // Decode and verify it cryptographically
    let decoded: RefreshPayload;
    try {
      decoded = fastify.jwt.refresh.verify<RefreshPayload>(token);
    } catch {
      throw fastify.httpErrors.unauthorized(
        'Invalid or expired refresh cookie',
      );
    }

    const { jti } = decoded;

    // Look up token in the professor's tracking database
    const trackedToken = lookupRefreshTokenRecord(jti);
    if (!trackedToken) {
      throw fastify.httpErrors.unauthorized('Invalid refresh token');
    }

    // REUSE DETECTION
    if (trackedToken.revoked) {
      revokeTokenFamilyRecords(trackedToken.familyId);
      throw fastify.httpErrors.unauthorized(
        'Refresh token reuse detected. Session terminated.',
      );
    }

    // Revoke the current token (single-use rule)
    revokeRefreshTokenRecord(jti);

    // Verify user still exists in database
    const db = await userdb;
    const u = db.getById(trackedToken.id);
    if (!u) {
      throw fastify.httpErrors.unauthorized('User no longer exists');
    }

    // Register the NEW refresh token
    const refreshTtl = Number(config.auth.refresh_token_expiration) || 604800;
    const newRecord = registerRefreshTokenRecord(
      u.name,
      u.id,
      trackedToken.role,
      refreshTtl,
      trackedToken.familyId,
    );

    // Sign the fresh tokens
    const newRefreshToken = fastify.jwt.refresh.sign({
      sub: u.name,
      jti: newRecord.tokenId,
      scope: ['refresh'],
    });

    const newAccessToken = fastify.jwt.access.sign({
      id: u.id,
      sub: u.name,
      role: trackedToken.role,
    });

    // Set the new cookie and return the payload
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

  /*
   * Create a new user and log them in.
   * New users are never admins.
   */
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
      /* Implement this.
       * Add new user to user db (hashing the password)
       * Log user in by issues refresh + access token.
       * Reuses code with /login endpoint
       */
      const db = await userdb;

      // Check if user already exists
      if (db.getByName(req.body.username)) {
        throw fastify.httpErrors.conflict('User already exists');
      }

      // Hash the password and create the user in the database
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

      // Set up token data (New users are ALWAYS just 'user')
      const role = 'user';
      const refreshTtl = Number(config.auth.refresh_token_expiration) || 604800;

      // Register the refresh token in the tracker
      const record = registerRefreshTokenRecord(u.name, u.id, role, refreshTtl);

      // Sign the Refresh Token
      const refreshToken = fastify.jwt.refresh.sign({
        sub: u.name,
        jti: record.tokenId,
        scope: ['refresh'],
      });

      // Sign the Access Token
      const accessToken = fastify.jwt.access.sign({
        id: u.id,
        sub: u.name,
        role: role,
      });

      // Set the Refresh Token as an HTTP-Only Cookie
      res.setCookie('refresh_token', refreshToken, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
      });

      // Set creation headers and return the access token JSON
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

  /*
   * Update user profile.  User may update only their own profile;
   * admin may update all profiles.
   */
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
      // Add preHandler here
      preHandler: [fastify.mustbeauthenticated],
    },
    async (req, _res) => {
      /* Implement this.
       * - Check authentication and retrieve user
       * - update user object properties (username, fullname, password)
       *   as given
       * - save new user.
       * - be careful to throw httpErrors.conflict if .save fails with
       *   'duplicate user name'
       */
      // Must be an admin OR the user modifying their own account
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

      // Check for duplicate username conflict
      if (req.body.username !== undefined) {
        const existingUser = db.getByName(req.body.username);
        if (existingUser && existingUser.id !== targetUser.id) {
          throw fastify.httpErrors.conflict('duplicate user name');
        }
        targetUser.name = req.body.username;
      }

      // Hash the new password if provided
      if (req.body.password !== undefined) {
        targetUser.password = await _bcrypt.hash(req.body.password, 10);
      }

      if (req.body.fullname !== undefined) {
        targetUser.fullname = req.body.fullname;
      }

      await db.save();
      return { message: 'user updated' };
    },
  );

  /* Delete user. */
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
      /* Implement this.
       * - check authentication
       * - delete user if successful
       */
      // Must be an admin OR the user deleting their own account
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

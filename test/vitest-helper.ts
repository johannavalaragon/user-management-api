// Vitest-compatible helper for building the Fastify app.
// Registers plugins and routes directly to avoid autoload's
// dynamic import of .ts files (which Node's ESM loader can't handle).
//
// userRoute is loaded with a dynamic import() inside buildTestApp() rather than
// a static import. This lets test files seed
// config.db.filename with the desired initial state *before* the route module
// is evaluated.  The route module resolves its module-level `userdb` Promise
// at load time (by reading the CSV), so any seeding must happen first.
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import responseValidation from '@fastify/response-validation';
import { config } from '../src/config.js';
import problemDetailsPlugin from '../src/plugins/problem-details.js';
import sensiblePlugin from '../src/plugins/sensible.js';
import supportPlugin from '../src/plugins/support.js';
import rootRoute from '../src/routes/root.js';

export type BuildTestAppOptions = {
  cookies?: boolean;
};

function joinRoutePrefixes(parent: string, child: string): string {
  return `${parent.replace(/\/$/, '')}${child}`;
}

export async function buildTestApp(options: BuildTestAppOptions = {}) {
  const { cookies = false } = options;
  const apiPrefix = config.routes.api_prefix;
  const userPrefix = joinRoutePrefixes(apiPrefix, config.routes.user_prefix);
  const { default: userRoute } = await import('../src/routes/user/index.js');
  const fastify = Fastify({
    ajv: { customOptions: { removeAdditional: false } },
  });
  if (cookies) {
    await fastify.register(fastifyCookie);
  }
  await fastify.register(responseValidation, {
    ajv: { removeAdditional: false },
  });
  await fastify.register(sensiblePlugin);
  await fastify.register(problemDetailsPlugin);
  await fastify.register(supportPlugin);
  await fastify.register(rootRoute, { prefix: apiPrefix });
  await fastify.register(userRoute, { prefix: userPrefix });
  await fastify.ready();
  return fastify;
}
